import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Makio MeshLine",
  description: "A performant and customizable line solution for Three.js.",
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'API', link: '/api' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide' },
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/api' },
        ]
      },
      {
        text: 'Classes',
        items: [
          { text: 'MeshLine', link: '/meshline' },
          { text: 'MeshLineGeometry', link: '/meshline-geometry' },
          { text: 'MeshLineNodeMaterial', link: '/meshline-material' },
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