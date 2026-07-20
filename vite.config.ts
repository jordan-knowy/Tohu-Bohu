import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [{
    name: 'tohu-app-history-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [pathname, query = ''] = (request.url ?? '').split('?')
        const suffix = query ? `?${query}` : ''
        if (pathname === '/connexion') request.url = `/login.html${suffix}`
        else if (pathname === '/bienvenue') request.url = `/onboarding.html${suffix}`
        else if (pathname === '/app' || pathname.startsWith('/app/') || pathname === '/super-admin' || pathname.startsWith('/super-admin/')) request.url = `/app.html${suffix}`
        next()
      })
    },
  }],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        onboarding: resolve(__dirname, 'onboarding.html'),
        app: resolve(__dirname, 'tohu-app.html'),
        reactApp: resolve(__dirname, 'app.html'),
      },
    },
  },
})
