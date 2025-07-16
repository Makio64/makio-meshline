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
      { text: 'Demos', link: 'https://meshlines.netlify.app/' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Why Makio MeshLine ?', link: '/why-makio-meshline' },
          { text: 'Getting Started', link: '/guide' },
          { text: 'Changelog & Roadmap', link: '/changelog-roadmap' },
        ]
      },
      {
        text: 'Examples',
        items: [
          { text: 'Interactive Sandbox', link: '/examples/sandbox' },
          { text: 'Basic Examples', link: '/examples/basic' },
          { text: 'GPU Circle', link: '/examples/gpucircle' },
          { text: 'Instancing', link: '/examples/instancing' },
          { text: 'Live Demos', link: 'https://meshlines.netlify.app/' },
        ]
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api' },
          { text: 'MeshLine', link: '/meshline' },
          { text: 'MeshLineGeometry', link: '/meshline-geometry' },
          { text: 'MeshLineNodeMaterial', link: '/meshline-material' },
          { text: 'Performance', link: '/performance' },
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