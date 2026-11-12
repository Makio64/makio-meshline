---
description: "Explore an adaptive 3D road planner with authored XYZ controls, elevation, per-point banking, local edits, strict tessellation budgets, level frames, and distance UVs."
outline: false
pageClass: example-page
---

# Road Surface

This example turns authored XYZ controls into one lit road with real world-space width. Orbiting the camera does not change its frame or thickness, while elevation and bank can carry the same route over terrain, bridges, and stacked crossings.

In the live demo, every track is a closed circuit with at least three controls. Drag a control to reshape the route while preserving its clearance above the ground. **Shift-drag** vertically to change that clearance and **Alt-drag** horizontally to bank the selected point. The arrow and arc gizmos on the selected point expose the same height and bank controls for touch input, and so do the two sliders of the point panel. Double-click the ground to add a point; double-click or right-click a point to remove it, down to three points. Use the **3D overpass** preset to start with a banked loop that crosses its own approach on a bridge; the embankments, the box-girder deck with its parapets, and the piers are generated from the same built road every time it changes. The road itself is the one MeshLine ribbon: the **Structure** button (B) steps through what is built around it — none, a simple wall under each edge with hammerhead piers, or the complex bridge with its embankments — and **Wireframe** (W) shows the ribbon's triangles. Only the outside of the bridge is drawn, so nothing shows inside it through a wireframe road. The Saves panel autosaves the current route, stores named copies in the browser, and can export JSON or copy a share link that restores the same controls, width, elevation, and bank.

A control is orange where the road passes smoothly, blue where the planner rounded it into a corner, and red where the road is too tight to build: a bend with too little room to turn, or a banked deck that would fold over a sharp crest or dip. An impossible edit leaves the last safe road visible, says so, and dashes the refused route over the scene. A saved or shared road that opens on such a point has no earlier shape to keep, so it is drawn folded there rather than not at all.

Cars drive continuous laps in both lanes, each standing on the banked deck with both axles. Longer circuits get more cars, and shortening the circuit reduces traffic. Click one, or switch to **Follow** or **Drive**, to trail it or sit in its seat; **Edit** brings the controls back. Edit and Follow keep traffic at a relaxed pace; Drive slows it further, so the road and the dashboard stay readable from the driver's seat.

The raw adaptive planner passes exactly through every authored XYZ point. Gentle knots use widened cubic tangents; a turn the cubic cannot hold becomes a circular arc in the plane of its incoming and outgoing 3D legs, still with the authored point as an exact middle sample. A full reversal uses the configured up direction to choose its otherwise ambiguous turn plane.

Edits stay local. Each smooth knot takes its plan heading from the horizontal directions of its two legs alone, and its grade from a monotone blend of their slopes that is level at a crest, a dip, or a flat approach. Raising or lowering a control therefore reshapes only the spans beside it: the road next to it neither swings sideways nor dips or overshoots between its controls. The minimum radius limits the sideways turn a level road actually feels, so crests and dips do not widen the plan. Tangent widening and arc conversion are solved separately for each run of difficult knots, so a tight bend at one end of the route cannot reshape the other end.

For the terrain demo, authored height is a minimum: the surface fitter may lift both controls around an affected span before running the planner again. Orange handles remain the authored targets, so the fitted road can sit above one when a wide, banked deck needs more ground clearance.

Tessellation is driven by strict geometric budgets, not by a fixed sample count. In this demo no accepted edge exceeds `36` world units, cubic chord deviation stays within `0.085`, tangent direction changes by at most about `5.6°` per step, and interpolated bank changes by at most `1°` per step. Each stretch between two controls is sampled as one curve — the half turn leaving its first control, the span, the half turn entering its second — and every row takes the same share of those budgets where it lies, so rows change length only as the road changes shape. Straight spans use the exact minimum row count, while steep slopes, tight turns, and fast roll changes receive the rows they need. Terrain fitting audits the complete banked, mitered surface — including its actual edge vertices — then raises the neighboring control span and re-plans. The final rendered centreline therefore keeps the same spacing and turn guarantees instead of acquiring sharp kinks from per-row clamping. Elevated spans remain elevated, and an impossible sub-width edit keeps the last safe road visible.

The sampled XYZ path uses `fixed-up` frames, so every row starts level and then takes the bank interpolated by travelled distance from its two controls. A rotation-minimizing `transport` frame would carry the twist of every climbing turn down the rest of the route: raising or banking one control would roll every span after it, and the terrain fit would then lift those far controls to keep the tilted edges above ground. Because the planner has already rounded the centreline, the surface can use compact miter-and-butt topology instead of adding a variable-topology fan at every tiny turn.

Every band of the road — the verge, the shoulders, the worn wheel tracks, the solid edge lines and the dashed centre — is painted in one fragment node from the surface UVs. The same node reads how far each fragment stands above the terrain: on the ground the shoulder is gravel and the verge is graded earth, on a bridge the shoulder is paved and the verge is the concrete kerb the parapet stands on. The whole road is a single ribbon, so there are no stacked overlay meshes to z-fight, no second geometry to rebuild on every drag, and nothing that can slip under the terrain or lag a frame behind the road it belongs to. The paint is pinned to the controls: each span is rescaled to a whole number of dash periods, so an edit re-spaces only the dashes on the spans it reshapes instead of sliding every dash and grain speck after it. The planner also never leaves a row much shorter than the one beside it, whether in a hairpin, next to a rounded corner or between two controls set close together: a short row beside a long one turns more than its inner edge has room for, and `inner: 'clip'` would then have to trim that join. Where a join is trimmed all the same, on a road that folds, the surface gives the clipped corner the UV of the point it stops at, so the bands keep their width. Bridge piers restart their spacing at every control for the same reason.

The asphalt combines filtered aggregate, tone that drifts across the world, polished wheel tracks, weathered paint, and varying roughness; the concrete has mineral mottling, fine surface pores, rain streaks, and the joints it was cast with, cut on the same pinned distance as the paint. Low stretches of road stand on a grass embankment, which stops in a slope of its own where the deck climbs away and the girder and its piers take over. Half-resolution GTAO with depth-aware denoising adds contact shading around cars, bridge supports, and terrain through the indirect lighting, while the main scene retains MSAA.

<iframe loading="lazy" title="Makio MeshLine Road Surface demo" src="https://meshline-demo.makio.io/examples/surface-road?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

[Open the full Road Surface demo](https://meshline-demo.makio.io/examples/surface-road)

[Open the standalone Track Maker preview](https://track-maker.makio.io)

## Copy-Paste Example

```js
import { MeshLine } from 'makio-meshline'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
	CanvasTexture,
	Color,
	DirectionalLight,
	HemisphereLight,
	PerspectiveCamera,
	RepeatWrapping,
	Scene,
	SRGBColorSpace,
	WebGPURenderer,
} from 'three/webgpu'

const createRoadPath = ( pointCount = 192 ) => {
	const points = new Float32Array( pointCount * 3 )

	for ( let i = 0; i < pointCount; i++ ) {
		const progress = i / ( pointCount - 1 )
		const offset = i * 3

		points[offset] = ( progress - 0.5 ) * 34
		points[offset + 1] = Math.sin( progress * Math.PI ) * 0.15
		points[offset + 2] = Math.sin( progress * Math.PI * 2 ) * 4
			+ Math.sin( progress * Math.PI * 5 ) * 0.75
	}

	return points
}

const createRoadTexture = () => {
	const canvas = document.createElement( 'canvas' )
	canvas.width = 512
	canvas.height = 128
	const context = canvas.getContext( '2d' )

	context.fillStyle = '#252a2f'
	context.fillRect( 0, 0, canvas.width, canvas.height )
	context.fillStyle = '#f4f0dc'
	context.fillRect( 0, 8, canvas.width, 5 )
	context.fillRect( 0, canvas.height - 13, canvas.width, 5 )
	context.fillStyle = '#f3c74f'
	context.fillRect( 48, canvas.height / 2 - 3, 300, 6 )

	const texture = new CanvasTexture( canvas )
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.colorSpace = SRGBColorSpace
	return texture
}

const renderer = new WebGPURenderer( { antialias: true } )
renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) )
renderer.setSize( innerWidth, innerHeight )
document.body.appendChild( renderer.domElement )
await renderer.init()

const scene = new Scene()
scene.background = new Color( 0x9cc2d6 )
const camera = new PerspectiveCamera( 55, innerWidth / innerHeight, 0.1, 100 )
camera.position.set( 0, 17, 25 )

const controls = new OrbitControls( camera, renderer.domElement )
controls.target.set( 0, 0, 0 )
controls.update()

const roadTexture = createRoadTexture()
roadTexture.anisotropy = renderer.getMaxAnisotropy()
const road = new MeshLine()
	.lines( createRoadPath() )
	.lineWidth( 3.2 )
	.color( 0xffffff )
	.map( roadTexture )
	.surface( {
		frame: 'fixed-up',
		up: [0, 1, 0],
		bank: progress => Math.sin( progress * Math.PI * 2 ) * 0.045,
		uvMode: 'distance',
		uvScale: 5,
		roughness: 0.88,
		metalness: 0,
	} )
	.join( { type: 'miter', limit: 3, inner: 'clip' } )
	.cap( { type: 'butt' } )
	.build()

scene.add( road )
scene.add( new HemisphereLight( 0xeaf5ff, 0x3d482c, 2.2 ) )

const sun = new DirectionalLight( 0xfff2d2, 3.2 )
sun.position.set( -8, 18, 10 )
scene.add( sun )

renderer.setAnimationLoop( () => renderer.render( scene, camera ) )

addEventListener( 'resize', () => {
	camera.aspect = innerWidth / innerHeight
	camera.updateProjectionMatrix()
	renderer.setSize( innerWidth, innerHeight )
} )
```

`MeshLine` consumes the supplied `Float32Array` as an XYZ polyline; the surface builder does not fit a spline or subdivide long spans on its own. The compact standalone generator therefore supplies enough rows for its curve, while the live demo puts its adaptive planner in front of the same public `MeshLine` API.

`uvMode: 'distance'` measures the full 3D polyline distance, including elevation, so adding or redistributing centerline samples does not change the physical texture scale. Maximum renderer anisotropy keeps the repeated road texture clearer at grazing camera angles. The small `bank` callback rotates the complete surface frame around the path tangent.

Miter/butt sections stay on the compact two-vertices-per-row topology. Use `join: { type: 'round', segments: 8 }` or a round cap when an intentionally sharp input polyline needs true fan topology. The opt-in `inner: 'clip'` policy is a final guard for continuously edited routes; the planner's curvature and sampling budgets normally keep the full-width offset valid before geometry construction. See [World-Space Surfaces](../surface.md) for the geometry contract.
