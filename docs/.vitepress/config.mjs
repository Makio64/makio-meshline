import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Makio MeshLine",
  description: "A performant and customizable line solution for Three.js.",
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide' },
      // { text: 'API', link: '/api' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide' },
        ]
      },
      // {
      //   text: 'API',
      //   items: [
      //     { text: 'MeshLine Class', link: '/api' },
      //   ]
      // }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/makio64/makio-meshline' }
    ]
  }
}) 