import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const readDemo = name => read( `demo/src/demos/${name}.js` )

test( 'GPU Culling reports warm-up, active, baseline, and draw-all states without covering the scene', async () => {
	const [source, ui, exampleView] = await Promise.all( [
		readDemo( 'gpuCulling' ),
		read( 'demo/src/components/GpuCulling.vue' ),
		read( 'demo/src/ExampleView.vue' ),
	] )
	const update = source.slice( source.indexOf( '\tupdate = dt => {' ), source.indexOf( '\tupdateCamera( dt ) {' ) )

	// No instruction text: ExampleView falls back to an empty one.
	assert.doesNotMatch( source, /^\s*(?:this\.)?text = /m )
	assert.match( exampleView, /this\.text = this\.example\.text \|\| ''/ )
	assert.match( source, /uiComponent = markRaw\( GpuCulling \)/ )
	assert.match( ui, /\.GpuCullingHud\n\tposition fixed[\s\S]*?left calc\(/ )
	assert.match( ui, /aria-live="polite"/ )
	assert.match( source, /badge = 'WebGPU warm-up'/ )
	assert.match( source, /badge = 'WebGPU active'/ )
	assert.match( source, /badge = 'Culling off'/ )
	assert.match( source, /badge = backend === 'webgl2' \? 'WebGL2 fallback' : 'Draw-all fallback'/ )
	// The frame loop drives the HUD, so warm-up to active shows without a click,
	// and ExampleView holds the only subscription, which ends with the demo.
	assert.match( update, /this\.updateHud\(\)/ )
	assert.match( exampleView, /if \( update \) stage3d\.listen\( stage\.onUpdate, update \)/ )
	assert.doesNotMatch( source, /stage\.onUpdate\.(?:add|remove)/ )
	assert.match( source, /window\.__meshLineCullingMetrics = null/ )
} )

test( 'GPU Culling reads its snapshot for the culled camera before moving it', async () => {
	const source = await readDemo( 'gpuCulling' )
	const update = source.slice( source.indexOf( '\tupdate = dt => {' ), source.indexOf( '\tupdateCamera( dt ) {' ) )

	// A handle refuses to report a camera it has not prepared, so reading after
	// the flight step silently yields no snapshot at all.
	assert.ok( update.indexOf( 'this.readSnapshot()' ) !== -1 )
	assert.ok( update.indexOf( 'this.readSnapshot()' ) < update.indexOf( 'this.updateCamera( dt )' ) )
	assert.match( source, /handle\.readCullingSnapshot\(\)/ )
	assert.match( source, /this\.culling\.remove\( this\.handle \)/, 'the baseline toggle detaches the line instead of rebuilding the scene' )
} )

test( 'GPU Culling draws the tunnel flight and its mini map from one culled line', async () => {
	const [source, ui, terrain, shading] = await Promise.all( [
		readDemo( 'gpuCulling' ),
		read( 'demo/src/components/GpuCulling.vue' ),
		read( 'demo/src/utils/gpuCullingTerrain.js' ),
		read( 'demo/src/utils/gpuCullingShading.js' ),
	] )

	// The catalog and the docs quote 400,000 points: the range, the arches, then one lap per rail and lane.
	const count = name => Number( source.match( new RegExp( `const ${name} = (\\d+)\\n` ) )[1] )
	const rails = Number( terrain.match( /const RAILS = times\( (\d+), / )[1] )
	const lanes = terrain.match( /const LANES = \[(.*)\]\n/ )[1].split( ',' ).length
	const points = count( 'ROWS' ) * count( 'POINTS_PER_ROW' )
		+ count( 'ARCHES' ) * count( 'POINTS_PER_ARCH' )
		+ ( rails + lanes ) * count( 'POINTS_PER_LAP' )
	assert.ok( points >= 400_000 && points < 450_000, `${points} points` )
	assert.match( source, /\.lines\( \[\.\.\.buildRidgelines\( ROWS, POINTS_PER_ROW \), \.\.\.buildTunnel\( ARCHES, POINTS_PER_ARCH, POINTS_PER_LAP \)\] \)/ )
	// Neither hook reads progress, which would be a 6 MB array for 400,000 points.
	const tunnelFrom = source.indexOf( 'this.line = new MeshLine()' )
	assert.notEqual( tunnelFrom, -1, 'the culled line should remain statically inspectable' )
	const tunnel = source.slice( tunnelFrom, source.indexOf( '.build()', tunnelFrom ) ).replace( /\/\/.*$/gm, '' )
	assert.deepEqual( tunnel.match( /\.\w+Fn\(/g ), ['.colorFn(', '.widthFn('] )
	assert.match( tunnel, /\.colorFn\( rangeAndTunnelColor \)/ )
	assert.match( tunnel, /\.widthFn\( tunnelWidth \)/ )
	assert.match( tunnel, /^\t+\.needsProgress\( false \)$/m )
	assert.match( shading, /export const tunnelWidth = Fn\( \( \[\w+\] \) => \{/ )
	assert.match( shading, /export const rangeAndTunnelColor = Fn\( \( \[\w+\] \) => \{/ )
	assert.match( terrain, /export const TUNNEL_LAPS = RAILS\.length \+ LANES\.length\n/ )
	// Trails and glows run down the lap while the flight goes up it, so they come at the camera.
	assert.match( shading, /const along = fract\( lap\.mul\( TRAILS \)\.add\( pace\.mul\( 7\.3 \) \)\.add\( time\.mul\( /, 'the trail phase grows with time' )
	assert.match( shading, /const glow = cos\( lap\.mul\( GLOWS \)\.add\( time\.mul\( /, 'the glow phase grows with time' )
	assert.match( source, /this\.flight = \( this\.flight \+ dt \* 0\.001 \* FLY_SPEED \)/, 'the flight angle grows with time' )
	// A rail or a lane is only drawn where a trail runs: the light sketches the tunnel.
	assert.match( shading, /const lapLine = ice\.mul\( 0\.03 \)\.add\( aurora\.mul\( trail \)/ )
	// The arches fade with depth in the flying camera's view, in color and in width, and never in the overview.
	assert.match( shading, /const arch = .*\.mul\( archFade\.pow\( 2 \) \)\n/ )
	assert.match( shading, /glow\.mul\( 0\.9 \)\.add\( 0\.8 \)\.mul\( archFade \)/ )
	assert.match( source, /archReach\.value = view\.archReach\n/ )
	assert.match( source, /const OVERVIEW = \{.*archReach: 1e5 \}\n/ )
	assert.match( source, /const POV = \{.*archReach: 70 \}\n/ )

	// A vertex attribute, four vertices per point, tells the hooks the tunnel from the range.
	assert.match( source, /addVertexAttribute\( 'tunnel' \)/ )
	assert.match( source, /const firstTunnelVertex = ROWS \* POINTS_PER_ROW \* 4\n/ )
	assert.match( shading, /const kind = attribute\( 'tunnel', 'float' \)/ )
	// A width hook leaves culling without automatic bounds, so the demo supplies them.
	assert.match( source, /\.widthFn\( tunnelWidth \)/ )
	assert.match( source, /this\.culling\.add\( this\.line, \{ bounds: this\.chunkBounds, worldPadding: 0\.6 \} \)/ )

	// Both views draw the same scene, culled for the flying camera.
	assert.match( source, /cullCamera: this\.passCamera/ )
	assert.match( source, /this\.renderView\( povHero \? passCamera : camera, 0, 0, width, height \)/ )
	assert.match( source, /this\.renderView\( povHero \? camera : passCamera, inset\.x, inset\.y, inset\.width, inset\.height \)/ )
	// The inset overlaps the first view: its depth is cleared, and the background node repaints it.
	assert.match( source, /stage3d\.scene\.backgroundNode = color\( BACKGROUND \)/ )
	assert.match( source, /renderer\.clearDepth\(\)/ )
	// The blueprint and the frustum stay out of the cull camera's own view.
	assert.match( source, /this\.ghost\.visible = this\.frustum\.visible = view === OVERVIEW/ )
	assert.match( source, /this\.passCamera\.add\( this\.frustum \)/ )
	assert.match( ui, /class="GpuCullingInset"[\s\S]*?@click="api\.swapViews"/ )
} )
