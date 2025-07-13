import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Makio MeshLine",
  description: "A performant and customizable line solution for Three.js.",
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'API', link: '/api' },
      { text: 'Patterns', link: '/common-patterns' },
      { text: 'Helpers', link: '/helpers' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide' },
        ]
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api' },
          { text: 'MeshLine', link: '/meshline' },
          { text: 'MeshLineGeometry', link: '/meshline-geometry' },
          { text: 'MeshLineNodeMaterial', link: '/meshline-material' },
        ]
      },
      {
        text: 'Patterns',
        items: [
          { text: 'Common', link: '/common-patterns' },
          { text: 'Advanced', link: '/advanced-patterns' }
        ]
      },
      {
        text: 'Utilities',
        items: [
          { text: 'Helper Functions', link: '/helpers' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/makio64/makio-meshline' }
    ]
  }
}) 