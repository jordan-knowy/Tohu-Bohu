-- Aucun rabais annuel n'est défini dans la matrice produit.
-- L'annuel correspond donc strictement à douze mensualités.
update public.subscription_plans
set price_yearly = case id
  when 'solo' then 34800
  when 'pro' then 58800
  when 'business' then 106800
  else price_yearly
end
where id in ('solo', 'pro', 'business');
