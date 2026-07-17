import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [{
    name: 'tohu-app-history-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/app/')) request.url = '/app.html'
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
