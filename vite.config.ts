import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

const base = process.env.BASE_URL ?? '';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === 'app') {
    return {
      plugins: [
        react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      ],
      server: {
        port: 3000,
      },
      publicDir: 'public/',
      build: {
        outDir: 'build',
      },
      base,
    }
  }
  return {
    plugins: [
      react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      dts({ tsconfigPath: 'tsconfig.lib.json' }),
    ],
    server: {
      port: 3000,
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'src', 'lib', 'index.tsx'),
        name: 'ReactVnc',
        formats: ['es', 'umd'],
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react/jsx-runtime', '@novnc/novnc'],
        output: {
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react/jsx-runtime': 'ReactJSXRuntime',
            '@novnc/novnc': 'RFB',
          }
        }
      },
      copyPublicDir: false,
    }
  }
});
