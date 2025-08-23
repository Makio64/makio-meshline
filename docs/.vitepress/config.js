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
          { text: 'Getting Started', link: '/guide' }
        ]
      },
      {
        text: 'Examples',
        items: [
          { text: 'Interactive Sandbox', link: '/examples/sandbox' },
          { text: 'Basic Examples', link: '/examples/basic' },
          { text: 'Demo : Follow', link: '/examples/follow' },
          { text: 'Demo : Draw Lines', link: '/examples/drawlines' },
          { text: 'Demo : Rice Field', link: '/examples/ricefield' },
          { text: 'Demo : Venus & David', link: '/examples/venus-and-david' },
          { text: 'Tutorial : GPU position', link: '/examples/gpucircle' },
          { text: 'Tutorial : Instancing', link: '/examples/instancing' },
          { text: 'Demos page', link: 'https://meshlines.netlify.app/' },
        ]
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api' },
          { text: 'MeshLine', link: '/meshline' },
          { text: 'MeshLineGeometry', link: '/meshline-geometry' },
          { text: 'MeshLineNodeMaterial', link: '/meshline-material' },
          { text: 'Helper Functions', link: '/helpers' },
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
        text: 'Other',
        items: [
          { text: 'Performance', link: '/performance' },
          { text: 'Changelog & Roadmap', link: '/changelog-roadmap' },
        ]
      }

    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Makio64/Meshline' }
    ]
  }
}) 