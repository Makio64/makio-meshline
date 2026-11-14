import standaloneConfig from './vite.standalone.js'

// The village's brush and the sky are generated: the noise is the only file the scene reads,
// as soon as it starts, so the head asks for it with the page.
const NOISE = 'textures/noises/perlin/rgb-256x256.png'

export default standaloneConfig( 'rice-field', [NOISE], { preload: [{ href: `/${NOISE}`, as: 'image' }] } )
