import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [{
    name: 'tohu-app-history-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [pathname, query = ''] = (request.url ?? '').split('?')
        const suffix = query ? `?${query}` : ''
        if (pathname === '/') request.url = `/pages/index.html${suffix}`
        else if (/^\/(index|login|onboarding|cgu|confidentialite)\.html$/.test(pathname)) request.url = `/pages${pathname}${suffix}`
        else if (pathname === '/connexion') request.url = `/pages/login.html${suffix}`
        else if (pathname === '/bienvenue') request.url = `/pages/onboarding.html${suffix}`
        else if (pathname === '/confidentialite') request.url = `/pages/confidentialite.html${suffix}`
        else if (pathname === '/cgu') request.url = `/pages/cgu.html${suffix}`
        else if (pathname === '/app' || pathname.startsWith('/app/') || pathname === '/super-admin' || pathname.startsWith('/super-admin/') || pathname === '/preferences') request.url = `/app.html${suffix}`
        next()
      })
    },
  }],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'pages/index.html'),
        login: resolve(__dirname, 'pages/login.html'),
        onboarding: resolve(__dirname, 'pages/onboarding.html'),
        confidentialite: resolve(__dirname, 'pages/confidentialite.html'),
        cgu: resolve(__dirname, 'pages/cgu.html'),
        app: resolve(__dirname, 'tohu-app.html'),
        reactApp: resolve(__dirname, 'app.html'),
      },
    },
  },
})
