import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

type WebsiteAnalysis = {
  companyName: string | null;
  industry: string | null;
  positioning: string | null;
  targetCustomers: string[];
  productSignals: string[];
  valueProposition: string | null;
  confidence: number;
  summary: string;
};

function normalizeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function extractText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
}

function extractTitle(html: string) {
  return html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

function heuristicAnalysis(url: string, title: string | null, text: string): WebsiteAnalysis {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const companyName = title?.split(/[|–—-]/)[0]?.trim() || host.split('.')[0];
  const lower = text.toLowerCase();
  const industry =
    lower.includes('crm') || lower.includes('sales') ? 'Sales / CRM' :
    lower.includes('ai') || lower.includes('intelligence') ? 'AI / Software' :
    lower.includes('marketing') ? 'Marketing' :
    lower.includes('finance') || lower.includes('payment') ? 'Finance' :
    'B2B Software';

  const productSignals = [
    lower.includes('automation') ? 'Automatisation' : null,
    lower.includes('analytics') || lower.includes('dashboard') ? 'Analytics / dashboard' : null,
    lower.includes('ai') || lower.includes('intelligence') ? 'Intelligence artificielle' : null,
    lower.includes('integration') || lower.includes('connect') ? 'Connecteurs et intégrations' : null,
  ].filter(Boolean) as string[];

  const summary = text.slice(0, 360);

  return {
    companyName,
    industry,
    positioning: title,
    targetCustomers: lower.includes('enterprise') ? ['Entreprises mid-market / enterprise'] : ['Équipes business B2B'],
    productSignals: productSignals.length ? productSignals : ['Proposition détectée depuis le contenu public'],
    valueProposition: summary || null,
    confidence: text.length > 800 ? 58 : 35,
    summary: summary || `Site public ${host} analysé avec signaux limités.`,
  };
}

async function llmAnalysis(url: string, title: string | null, text: string): Promise<WebsiteAnalysis | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content:
            'Tu analyses un site public pour construire le contexte Knowy d’un utilisateur. Réponds uniquement en JSON valide. N’invente rien: si une donnée manque, mets null ou [].',
        },
        {
          role: 'user',
          content: JSON.stringify({
            url,
            title,
            text,
            expected_schema: {
              companyName: 'string|null',
              industry: 'string|null',
              positioning: 'string|null',
              targetCustomers: 'string[]',
              productSignals: 'string[]',
              valueProposition: 'string|null',
              confidence: 'number 0-100',
              summary: 'string',
            },
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'website_analysis',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyName: { type: ['string', 'null'] },
              industry: { type: ['string', 'null'] },
              positioning: { type: ['string', 'null'] },
              targetCustomers: { type: 'array', items: { type: 'string' } },
              productSignals: { type: 'array', items: { type: 'string' } },
              valueProposition: { type: ['string', 'null'] },
              confidence: { type: 'number' },
              summary: { type: 'string' },
            },
            required: ['companyName', 'industry', 'positioning', 'targetCustomers', 'productSignals', 'valueProposition', 'confidence', 'summary'],
          },
        },
      },
    }),
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const jsonText = payload.output_text;
  if (!jsonText) return null;

  return JSON.parse(jsonText) as WebsiteAnalysis;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const body = await req.json().catch(() => null);
  const url = normalizeUrl(body?.url ?? '');

  if (!url) {
    return jsonResponse({ error: 'url is required' }, 400);
  }

  try {
    const page = await fetch(url, {
      headers: {
        'User-Agent': 'KnowyBot/0.1 WebsiteContextAnalyzer',
      },
    });

    if (!page.ok) {
      return jsonResponse({ error: `Unable to fetch website: ${page.status}` }, 422);
    }

    const html = await page.text();
    const title = extractTitle(html);
    const text = extractText(html);
    const analysis = (await llmAnalysis(url, title, text)) ?? heuristicAnalysis(url, title, text);

    return jsonResponse({
      url,
      title,
      analysis,
      extractedTextSample: text.slice(0, 1000),
      usedLlm: Boolean(Deno.env.get('OPENAI_API_KEY')),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown website analysis error' }, 500);
  }
});

