import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Makio MeshLine",
  description: "A performant and customizable line solution for Three.js.",
  appearance: 'dark', // Set dark mode as default
  themeConfig: {
    nav: [
      { text: 'Guides', link: '/guide' },
      { text: 'Examples', link: '/examples/sandbox' },
      { text: 'API', link: '/api' },
      { text: 'Demos', link: 'https://meshlines.netlify.app/' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Makio MeshLine', link: '/why-makio-meshline' },
          { text: 'Getting Started', link: '/guide' }
        ]
      },
      {
        text: 'Examples',
        items: [
          { text: 'Interactive Sandbox', link: '/examples/sandbox' },
          { text: 'Basic Examples', link: '/examples/basic' },
          { text: 'Follow', link: '/examples/follow' },
          { text: 'GPU position', link: '/examples/gpucircle' },
          { text: 'Instancing', link: '/examples/instancing' },
          { text: 'Advanced : Draw Lines', link: '/examples/drawlines' },
          { text: 'Advanced : Rice Field', link: '/examples/ricefield' },
          { text: 'Advanced : Venus & David', link: '/examples/venus-and-david' },
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
          { text: 'Helpers', link: '/helpers' },
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
      { icon: 'github', link: 'https://github.com/Makio64/makio-meshline' }
    ]
  }
}) 