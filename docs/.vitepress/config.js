import { defineConfig } from 'vitepress'

const SITE_URL = 'https://meshline.makio.io'
const REPO_URL = 'https://github.com/Makio64/makio-meshline'
const DEMO_URL = 'https://meshline-demo.makio.io/'
const SITE_TITLE = 'Makio MeshLine'
const DEFAULT_DESCRIPTION = 'TSL-powered MeshLine for Three.js with wide lines, gradients, dashes, textures, shadows, GPU positions, and instancing for WebGPU and WebGL2.'
const SITE_IMAGE = `${SITE_URL}/og-image.svg`
const X_HANDLE = '@makio64'
const PAGE_DESCRIPTIONS = {
  'index.md': 'Makio MeshLine is a TSL-powered MeshLine library for Three.js with wide lines, gradients, dashes, textures, shadows, GPU positions, and instancing.',
  'guide.md': 'Get started with Makio MeshLine for Three.js, from installation to your first wide, dashed, gradient, or textured line in WebGPU.',
  'api.md': 'Browse the Makio MeshLine API reference for MeshLine, MeshLineGeometry, MeshLineNodeMaterial, hooks, helpers, and rendering options.',
  'why-makio-meshline.md': 'Learn why Makio MeshLine is a modern THREE.MeshLine alternative for Three.js with TSL, WebGPU, instancing, and GPU-driven workflows.',
  'common-patterns.md': 'Copy practical Makio MeshLine recipes for circles, dashed lines, gradients, textures, dynamic updates, and sharp-corner handling in Three.js.',
  'advanced-patterns.md': 'Explore advanced Makio MeshLine patterns for GPU positions, instancing, batching, animated dashes, and custom TSL material hooks.',
  'performance.md': 'Performance tips for Makio MeshLine covering instancing, batching, dynamic position updates, GPU positioning, and sharp-corner rendering.',
  'helpers.md': 'Reference helper functions like circlePositions, squarePositions, sineWavePositions, and straightLine for building Three.js MeshLine paths.',
  'meshline.md': 'Reference the main MeshLine class for Three.js wide lines, including styling, dashes, textures, hooks, instancing, and GPU positions.',
  'meshline-geometry.md': 'Reference MeshLineGeometry for efficient line mesh generation, attribute control, batching, and fast position updates in Makio MeshLine.',
  'meshline-material.md': 'Reference MeshLineNodeMaterial for Makio MeshLine, including gradients, dashes, textures, opacity, hooks, and miter join settings.',
  'changelog-roadmap.md': 'Track Makio MeshLine releases, rendering improvements, roadmap items, and upcoming work across WebGPU, joins, and geometry workflows.',
  'classes.md': 'Overview of Makio MeshLine core classes and how MeshLine, MeshLineGeometry, and MeshLineNodeMaterial work together in Three.js.',
  'examples/basic.md': 'Start with one shape and change one option at a time to learn MeshLine width, dashes, gradients, textures, opacity, and size attenuation.',
  'examples/follow.md': 'Build a responsive cursor trail in Three.js with Makio MeshLine by updating a short point array and reusing one dynamic line.',
  'examples/drawlines.md': 'Turn pointer input into painted strokes in Three.js with Makio MeshLine, dynamic positions, and replayable follower lines.',
  'examples/sandbox.md': 'Use the Makio MeshLine interactive sandbox to tune line shapes, joins, dashes, gradients, and exported Three.js code snippets.',
  'examples/instancing.md': 'Render many repeated lines with one draw call using Makio MeshLine instancing, per-instance attributes, and custom TSL hooks.',
  'examples/gpucircle.md': 'Use GPU-driven positions with Makio MeshLine and Three.js TSL to animate parametric circles and curves without CPU vertex uploads.',
  'examples/vertex-colors.md': 'Color each point in a Makio MeshLine with per-vertex RGB values for gradients, data-driven color ramps, and stylized trails.',
  'examples/shadow.md': 'See how Makio MeshLine lines cast shadows in Three.js, including dashed shadow behavior, spotlights, and custom shadow appearance.',
  'examples/bamboo.md': 'Build a procedural bamboo grove with Makio MeshLine instancing, custom TSL transforms, and shadow-casting line templates.',
  'examples/ricefield.md': 'Use Makio MeshLine instancing to render thousands of stylized grass or rice blades with small line templates and per-instance transforms.',
  'examples/venus-and-david.md': 'Morph one instanced MeshLine layout between sampled sculpture positions using TSL attributes and a single interpolation uniform.'
}

function stripMarkup( value = '' ) {
  return value
    .replace( /<[^>]+>/g, ' ' )
    .replace( /[`*_#[\]]/g, '' )
    .replace( /\s+/g, ' ' )
    .trim()
}

function normalizeDescription( value = '' ) {
  const clean = stripMarkup( value )

  if ( !clean ) {
    return DEFAULT_DESCRIPTION
  }

  return clean.length > 180 ? `${clean.slice( 0, 177 ).trimEnd()}...` : clean
}

function getPageDescription( pageData ) {
  return normalizeDescription(
    pageData.frontmatter.description ||
    pageData.description ||
    PAGE_DESCRIPTIONS[pageData.relativePath] ||
    DEFAULT_DESCRIPTION
  )
}

function getCanonicalPath( relativePath = '' ) {
  if ( !relativePath || relativePath === 'index.md' ) {
    return '/'
  }

  return `/${relativePath
    .replace( /(^|\/)index\.md$/, '$1index.html' )
    .replace( /\.md$/, '.html' )}`
    .replace( /\/+/g, '/' )
}

function getCanonicalUrl( relativePath ) {
  return `${SITE_URL}${getCanonicalPath( relativePath )}`
}

function getRobotsValue( pageData ) {
  return pageData.isNotFound || pageData.frontmatter.noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-image-preview:large'
}

function createHomeSchema( description ) {
  return JSON.stringify( {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: SITE_TITLE,
    description,
    url: SITE_URL,
    codeRepository: REPO_URL,
    programmingLanguage: 'JavaScript',
    runtimePlatform: 'WebGPU, WebGL2',
    license: `${REPO_URL}/blob/main/LICENSE`,
    image: SITE_IMAGE,
    author: {
      '@type': 'Person',
      name: 'David Ronai',
      url: 'https://github.com/Makio64'
    },
    keywords: [
      'three.js',
      'meshline',
      'wide lines',
      'thick lines',
      'webgpu',
      'webgl2',
      'tsl',
      'instancing'
    ]
  } )
}

export default defineConfig( {
  title: SITE_TITLE,
  description: DEFAULT_DESCRIPTION,
  appearance: 'dark',
  sitemap: {
    hostname: SITE_URL,
    transformItems( items ) {
      return items.filter( item => item.url !== '/404' && item.url !== '/404.html' )
    }
  },
  head: [
    ['meta', { name: 'author', content: 'David Ronai (Makio64)' }],
    ['meta', { name: 'keywords', content: 'three.js meshline, wide lines, thick lines, webgpu, webgl2, tsl, instancing, dashed lines, gradient lines' }],
    ['meta', { name: 'theme-color', content: '#101216' }],
    ['meta', { name: 'twitter:site', content: X_HANDLE }],
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:locale', content: 'en_US' }]
  ],
  transformPageData( pageData ) {
    return {
      description: getPageDescription( pageData )
    }
  },
  transformHead( context ) {
    const { pageData, title } = context
    const description = getPageDescription( pageData )
    const canonicalUrl = getCanonicalUrl( pageData.relativePath )
    const isHomePage = pageData.relativePath === 'index.md'
    const robots = getRobotsValue( pageData )
    const head = [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { name: 'robots', content: robots }],
      ['meta', { property: 'og:type', content: isHomePage ? 'website' : 'article' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:image', content: SITE_IMAGE }],
      ['meta', { property: 'og:image:type', content: 'image/svg+xml' }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:creator', content: X_HANDLE }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: SITE_IMAGE }]
    ]

    if ( isHomePage ) {
      head.push( ['script', { type: 'application/ld+json' }, createHomeSchema( description )] )
    }

    return head
  },
  themeConfig: {
    nav: [
      { text: 'Guides', link: '/guide' },
      { text: 'Examples', link: '/examples/basic' },
      { text: 'API', link: '/api' },
      { text: 'Demos', link: DEMO_URL },
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
          { text: 'Vertex Colors', link: '/examples/vertex-colors' },
          { text: 'Follow', link: '/examples/follow' },
          { text: 'GPU position', link: '/examples/gpucircle' },
          { text: 'Instancing', link: '/examples/instancing' },
          { text: 'Shadow', link: '/examples/shadow' },
          { text: 'Bamboo Grove', link: '/examples/bamboo' },
          { text: 'Advanced : Draw Lines', link: '/examples/drawlines' },
          { text: 'Advanced : Rice Field', link: '/examples/ricefield' },
          { text: 'Advanced : Venus & David', link: '/examples/venus-and-david' },
          { text: 'Demos page', link: DEMO_URL },
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
      { icon: 'github', link: REPO_URL }
    ]
  }
} )