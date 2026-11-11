import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from( source ).toString( 'base64' )}`
const stageUrl = moduleUrl( `
import { PerspectiveCamera, Scene } from '${import.meta.resolve( 'three/webgpu' )}'
export default {
	renderer: { toneMapping: 0, outputColorSpace: 'srgb' },
	scene: new Scene(),
	camera: new PerspectiveCamera(),
	owned: [],
	own( resource ) {
		this.owned.push( resource )
		return resource
	},
}
` )
const { default: stage } = await import( stageUrl )
const source = ( await readFile( new URL( '../demo/src/utils/roadPipeline.js', import.meta.url ), 'utf8' ) )
	.replace( /from '([^']+)'/g, ( _, specifier ) => `from '${specifier.startsWith( '@/' ) ? stageUrl : import.meta.resolve( specifier )}'` )
const { createRoadPipeline } = await import( moduleUrl( source ) )

test( 'demo cleanup releases every GTAO pass and detaches the road pipeline', () => {
	const pipeline = createRoadPipeline()
	assert.ok( stage.owned.includes( pipeline ), 'the scene must own the postprocessing resources' )
	assert.equal( stage.renderPipeline, pipeline.renderPipeline )
	const disposed = new Map()
	for ( const node of [pipeline.scenePass, pipeline.normalPass, pipeline.aoPass, pipeline.denoisePass, pipeline.denoisedAO] ) {
		disposed.set( node, 0 )
		node.addEventListener( 'dispose', () => disposed.set( node, disposed.get( node ) + 1 ) )
	}
	pipeline.dispose()
	assert.equal( stage.renderPipeline, null )
	assert.ok( [...disposed.values()].every( count => count === 1 ), 'each pass must release its targets and noise' )
} )

test( 'disposing an earlier road pipeline keeps its replacement active', () => {
	const previous = createRoadPipeline()
	const current = createRoadPipeline()
	previous.dispose()
	assert.equal( stage.renderPipeline, current.renderPipeline )
	current.dispose()
	assert.equal( stage.renderPipeline, null )
} )
