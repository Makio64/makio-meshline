import { MeshLine } from 'makio-meshline'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { attribute, cos, Fn, mix, sin, vec3 } from 'three/tsl'
import { Group } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const EXAMPLE_RADIUS = 1.55
const UNEVEN_POINT_COUNT = 22
const LOCAL_POINT_COUNT = 72
const LOCAL_EDIT_START = 9
const LOCAL_EDIT_COUNT = 12
const INSTANCE_COUNT = 14
const INSTANCE_BLOCK_START = 2
const INSTANCE_BLOCK_COUNT = 4
const WIDE_SPACING = 4.15
const PORTRAIT_SPACING = 3.8

const createCirclePath = ( pointCount, radius = EXAMPLE_RADIUS, z = 0 ) => {
	const points = new Float32Array( pointCount * 3 )

	for ( let i = 0; i < pointCount; i++ ) {
		const angle = i / pointCount * Math.PI * 2
		const offset = i * 3
		points[offset] = Math.sin( angle ) * radius
		points[offset + 1] = Math.cos( angle ) * radius
		points[offset + 2] = z
	}

	return points
}

const createUnevenPath = ( z = 0 ) => {
	const points = new Float32Array( UNEVEN_POINT_COUNT * 3 )
	const finalProgress = 1 - 1 / UNEVEN_POINT_COUNT

	for ( let i = 0; i < UNEVEN_POINT_COUNT; i++ ) {
		const sample = i / ( UNEVEN_POINT_COUNT - 1 )
		// Crowd source samples near the top while keeping a regular closing gap.
		const progress = sample ** 2.45 * finalProgress
		const angle = progress * Math.PI * 2
		const offset = i * 3
		points[offset] = Math.sin( angle ) * EXAMPLE_RADIUS
		points[offset + 1] = Math.cos( angle ) * EXAMPLE_RADIUS
		points[offset + 2] = z
	}

	return points
}

const createSampleTicks = points => {
	const ticks = []

	for ( let i = 0; i < points.length; i += 3 ) {
		const x = points[i]
		const y = points[i + 1]
		const inverseRadius = 1 / Math.hypot( x, y )
		const normalX = x * inverseRadius
		const normalY = y * inverseRadius
		ticks.push( new Float32Array( [
			x - normalX * 0.12,
			y - normalY * 0.12,
			0.02,
			x + normalX * 0.12,
			y + normalY * 0.12,
			0.02,
		] ) )
	}

	return ticks
}

const createRangeColors = () => {
	const colors = new Float32Array( LOCAL_POINT_COUNT * 3 )

	for ( let i = 0; i < LOCAL_POINT_COUNT; i++ ) {
		const isEdited = i >= LOCAL_EDIT_START && i < LOCAL_EDIT_START + LOCAL_EDIT_COUNT
		const offset = i * 3
		colors[offset] = isEdited ? 1 : 0.2
		colors[offset + 1] = isEdited ? 0.77 : 0.27
		colors[offset + 2] = isEdited ? 0.08 : 0.36
	}

	return colors
}

const createChevronTemplate = () => new Float32Array( [
	-0.22,
	-0.14,
	0,
	0,
	0.2,
	0,
	0.22,
	-0.14,
	0,
] )

class V2UpdatesExample {
	constructor() {
		this.lines = []
		this.groups = []
		this.labels = []
		this.cssRenderer = null
		this.control = null
		this.hud = null
		this.hudStyle = null
		this.arcLine = null
		this.localLine = null
		this.instancedLine = null
		this.localEdit = new Float32Array( LOCAL_EDIT_COUNT * 3 )
		this.instanceOffsets = new Float32Array( INSTANCE_COUNT * 3 )
		this.instanceAngles = new Float32Array( INSTANCE_COUNT )
		this.instanceActive = new Float32Array( INSTANCE_COUNT )
		this.instanceBlockOffsets = new Float32Array( INSTANCE_BLOCK_COUNT * 3 )
		this.time = 0
	}

	async init() {
		await stage3d.initRender()
		this.createCssRenderer()
		this.createHud()
		this.createExamples()
		this.createControl()
		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
		this.onResize()
	}

	createCssRenderer() {
		this.cssRenderer = new CSS2DRenderer()
		this.cssRenderer.domElement.style.position = 'absolute'
		this.cssRenderer.domElement.style.inset = '0'
		this.cssRenderer.domElement.style.pointerEvents = 'none'
		document.body.appendChild( this.cssRenderer.domElement )
	}

	createHud() {
		this.hudStyle = document.createElement( 'style' )
		this.hudStyle.textContent = `
			.V2UpdatesHud {
				position: fixed;
				top: calc(14px + var(--sait, 0px));
				left: calc(14px + var(--sail, 0px));
				z-index: 20;
				display: flex;
				align-items: center;
				gap: 9px;
				padding: 8px 11px;
				border: 1px solid rgba(148, 163, 184, .16);
				border-radius: 999px;
				background: rgba(9, 12, 18, .68);
				box-shadow: 0 10px 32px rgba(0, 0, 0, .28);
				backdrop-filter: blur(10px);
				color: #f8fafc;
				font: 650 11px/1 system-ui, sans-serif;
				pointer-events: none;
				user-select: none;
			}
			.V2UpdatesHud__live {
				width: 7px;
				height: 7px;
				border-radius: 999px;
				background: #4ade80;
				box-shadow: 0 0 12px #4ade80;
				animation: v2UpdatesPulse 1.5s ease-in-out infinite;
			}
			.V2UpdatesHud__hint {
				padding-left: 9px;
				border-left: 1px solid rgba(148, 163, 184, .2);
				color: rgba(226, 232, 240, .58);
				font-weight: 550;
			}
			.V2UpdatesLabel {
				box-sizing: border-box;
				width: 210px;
				padding: 8px 10px 9px;
				border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
				border-radius: 12px;
				background: rgba(9, 12, 18, .78);
				box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
				backdrop-filter: blur(9px);
				color: #f8fafc;
				font-family: Inter, system-ui, sans-serif;
				text-align: center;
				pointer-events: none;
				user-select: none;
			}
			.V2UpdatesLabel__title {
				color: var(--accent);
				font-size: 11px;
				font-weight: 750;
				letter-spacing: .1em;
				line-height: 1.1;
				text-transform: uppercase;
			}
			.V2UpdatesLabel__detail {
				margin-top: 4px;
				color: rgba(226, 232, 240, .72);
				font-size: 11px;
				line-height: 1.25;
			}
			.V2UpdatesLabel__api {
				display: inline-block;
				margin-top: 6px;
				padding: 3px 6px;
				border-radius: 5px;
				background: rgba(148, 163, 184, .1);
				color: rgba(241, 245, 249, .62);
				font: 600 9px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
			}
			@keyframes v2UpdatesPulse {
				0%, 100% { opacity: .45; transform: scale(.82); }
				50% { opacity: 1; transform: scale(1); }
			}
			@media (max-width: 700px) {
				.V2UpdatesHud {
					top: calc(9px + var(--sait, 0px));
					left: calc(9px + var(--sail, 0px));
					padding: 7px 9px;
					font-size: 10px;
				}
				.V2UpdatesHud__hint { display: none; }
				.V2UpdatesLabel {
					width: min(188px, calc(100vw - 88px));
					padding: 6px 8px 7px;
				}
				.V2UpdatesLabel__detail { font-size: 10px; }
				.V2UpdatesLabel__api { margin-top: 4px; }
			}
		`
		document.head.appendChild( this.hudStyle )

		this.hud = document.createElement( 'aside' )
		this.hud.className = 'V2UpdatesHud'
		this.hud.setAttribute( 'aria-label', 'Live animation and camera controls' )

		const live = document.createElement( 'span' )
		live.className = 'V2UpdatesHud__live'
		const title = document.createElement( 'span' )
		title.textContent = 'Updating live'
		const hint = document.createElement( 'span' )
		hint.className = 'V2UpdatesHud__hint'
		hint.textContent = 'Drag to orbit · Scroll to zoom'
		this.hud.append( live, title, hint )
		document.body.appendChild( this.hud )
	}

	createExamples() {
		const arcGroup = this.createGroup()
		const partialGroup = this.createGroup()
		const instanceGroup = this.createGroup()

		this.createArcLengthExample( arcGroup )
		this.createPartialUpdateExample( partialGroup )
		this.createInstanceUpdateExample( instanceGroup )
	}

	createGroup() {
		const group = new Group()
		stage3d.add( group )
		this.groups.push( group )
		return group
	}

	createArcLengthExample( group ) {
		const unevenPoints = createUnevenPath()
		this.addLine(
			new MeshLine()
				.lines( createUnevenPath( -0.02 ), true )
				.color( 0x1e293b )
				.lineWidth( 0.18 ),
			group
		)
		this.arcLine = this.addLine(
			new MeshLine()
				.lines( unevenPoints, true )
				.color( 0x22d3ee )
				.gradientColor( 0xf472b6 )
				.dash( { count: 14, ratio: 0.62 } )
				.lineWidth( 0.11 ),
			group
		)
		this.addLine(
			new MeshLine()
				.lines( createSampleTicks( unevenPoints ), false )
				.color( 0xffffff )
				.opacity( 0.58 )
				.lineWidth( 0.025 ),
			group
		)
		this.addLabel(
			group,
			'Even spacing',
			'Uneven points → even moving dashes',
			'arc-length progress',
			'#67e8f9'
		)
	}

	createPartialUpdateExample( group ) {
		this.addLine(
			new MeshLine()
				.lines( createCirclePath( LOCAL_POINT_COUNT, EXAMPLE_RADIUS, -0.02 ), true )
				.color( 0x172033 )
				.lineWidth( 0.2 ),
			group
		)

		this.localLine = this.addLine(
			new MeshLine()
				.lines( createCirclePath( LOCAL_POINT_COUNT ), true )
				.vertexColors( createRangeColors() )
				.lineWidth( 0.11 )
				.dynamic( true )
				.setFrustumCulled( false ),
			group
		)
		this.addLabel(
			group,
			'Edit one slice',
			'Updates 12 of 72 points',
			'setPositionRange()',
			'#fde047'
		)
	}

	createInstanceUpdateExample( group ) {
		this.addLine(
			new MeshLine()
				.lines( createCirclePath( 64, EXAMPLE_RADIUS, -0.02 ), true )
				.color( 0x1e293b )
				.opacity( 0.72 )
				.lineWidth( 0.03 ),
			group
		)

		this.instancedLine = new MeshLine()
			.lines( createChevronTemplate(), false )
			.instances( INSTANCE_COUNT )
			.color( 0xffffff )
			.lineWidth( 0.11 )
			.dynamic( true )
			.setFrustumCulled( false )
			.positionFn( Fn( ( [position] ) => {
				const angle = attribute( 'instanceAngle', 'float' )
				const angleCos = cos( angle )
				const angleSin = sin( angle )
				const rotated = vec3(
					position.x.mul( angleCos ).sub( position.y.mul( angleSin ) ),
					position.x.mul( angleSin ).add( position.y.mul( angleCos ) ),
					position.z
				)
				return rotated.add( attribute( 'instanceOffset', 'vec3' ) )
			} ) )
			.colorFn( Fn( () => {
				return mix(
					vec3( 0.22, 0.34, 0.48 ),
					vec3( 1, 0.34, 0.2 ),
					attribute( 'instanceActive', 'float' )
				)
			} ) )

		this.instancedLine.addInstanceAttributes( {
			instanceOffset: 3,
			instanceAngle: 1,
			instanceActive: 1,
		} )

		for ( let i = 0; i < INSTANCE_COUNT; i++ ) {
			const angle = i / INSTANCE_COUNT * Math.PI * 2
			const offset = i * 3
			this.instanceOffsets[offset] = Math.sin( angle ) * EXAMPLE_RADIUS
			this.instanceOffsets[offset + 1] = Math.cos( angle ) * EXAMPLE_RADIUS
			this.instanceOffsets[offset + 2] = 0
			this.instanceAngles[i] = -angle
			this.instanceActive[i] = i >= INSTANCE_BLOCK_START && i < INSTANCE_BLOCK_START + INSTANCE_BLOCK_COUNT ? 1 : 0
		}

		this.instancedLine.setInstanceValues( 'instanceOffset', this.instanceOffsets )
		this.instancedLine.setInstanceValues( 'instanceAngle', this.instanceAngles )
		this.instancedLine.setInstanceValues( 'instanceActive', this.instanceActive )
		this.addLine( this.instancedLine, group )
		this.addLabel(
			group,
			'Edit a batch',
			'Four instances move together',
			'setInstanceValues()',
			'#fb7185'
		)
	}

	addLine( line, group ) {
		group.add( line )
		this.lines.push( line )
		return line
	}

	addLabel( group, title, detail, api, accent ) {
		const element = document.createElement( 'div' )
		element.className = 'V2UpdatesLabel'
		element.style.setProperty( '--accent', accent )

		const titleElement = document.createElement( 'div' )
		titleElement.className = 'V2UpdatesLabel__title'
		titleElement.textContent = title
		const detailElement = document.createElement( 'div' )
		detailElement.className = 'V2UpdatesLabel__detail'
		detailElement.textContent = detail
		const apiElement = document.createElement( 'code' )
		apiElement.className = 'V2UpdatesLabel__api'
		apiElement.textContent = api
		element.append( titleElement, detailElement, apiElement )

		const label = new CSS2DObject( element )
		label.center.set( 0.5, 0 )
		label.position.set( 0, -2.02, 0.02 )
		group.add( label )
		this.labels.push( label )
	}

	createControl() {
		this.control = new OrbitControl( stage3d.camera, 10 )
		this.control._phi = 1.42
		this.control._theta = 1.44
		this.control.isThetaRestricted = true
		this.control.minTheta = 1.05
		this.control.maxTheta = 2.05
		this.control.minPhi = 1.02
		this.control.maxPhi = 1.92
		this.control.enablePan = false
		this.control.blockPan = true
		stage3d.control = this.control
	}

	applyLayout() {
		const aspect = stage.width / stage.height
		const portrait = stage.width < 720 || aspect < 0.9
		const positions = portrait
			? [
				{ x: 0, y: PORTRAIT_SPACING, z: 0.12 },
				{ x: 0, y: 0, z: 0 },
				{ x: 0, y: -PORTRAIT_SPACING, z: -0.12 },
			]
			: [
				{ x: -WIDE_SPACING, y: 0, z: 0.12 },
				{ x: 0, y: 0, z: 0 },
				{ x: WIDE_SPACING, y: 0, z: -0.12 },
			]

		this.groups.forEach( ( group, index ) => {
			const position = positions[index]
			group.position.set( position.x, position.y, position.z )
			group.rotation.y = ( index - 1 ) * -0.055
		} )

		const halfWidth = portrait ? 2.15 : WIDE_SPACING + 1.95
		const halfHeight = portrait ? PORTRAIT_SPACING + 2.35 : 2.45
		const fovScale = Math.tan( stage3d.camera.fov * Math.PI / 360 )
		const cameraDistance = Math.max(
			9.5,
			halfHeight / fovScale,
			halfWidth / ( fovScale * aspect )
		)

		if ( this.control ) {
			this.control.radius = cameraDistance
			this.control._radius = cameraDistance
			this.control.minRadius = cameraDistance * 0.72
			this.control.maxRadius = cameraDistance * 1.9
			this.control.update()
		}
	}

	update = dt => {
		this.time += dt * 0.001

		if ( this.arcLine?.material.dashOffset ) {
			this.arcLine.material.dashOffset.value = -this.time * 1.35
		}

		for ( let i = 0; i < LOCAL_EDIT_COUNT; i++ ) {
			const pointIndex = LOCAL_EDIT_START + i
			const angle = pointIndex / LOCAL_POINT_COUNT * Math.PI * 2
			const progress = i / ( LOCAL_EDIT_COUNT - 1 )
			const envelope = Math.sin( progress * Math.PI )
			const wave = Math.sin( this.time * 3.4 - progress * Math.PI * 2 )
			const radius = EXAMPLE_RADIUS + envelope * ( 0.28 + wave * 0.24 )
			const offset = i * 3
			this.localEdit[offset] = Math.sin( angle ) * radius
			this.localEdit[offset + 1] = Math.cos( angle ) * radius
			this.localEdit[offset + 2] = 0
		}
		// Preserve the topology and replace only this contiguous point slice.
		this.localLine.setPositionRange( this.localEdit, LOCAL_EDIT_START, { updateBounding: false } )

		const batchPulse = 0.3 + Math.sin( this.time * 3 ) * 0.2
		for ( let i = 0; i < INSTANCE_BLOCK_COUNT; i++ ) {
			const instanceIndex = INSTANCE_BLOCK_START + i
			const angle = instanceIndex / INSTANCE_COUNT * Math.PI * 2
			const radius = EXAMPLE_RADIUS + batchPulse
			const offset = i * 3
			this.instanceBlockOffsets[offset] = Math.sin( angle ) * radius
			this.instanceBlockOffsets[offset + 1] = Math.cos( angle ) * radius
			this.instanceBlockOffsets[offset + 2] = 0
		}
		// One bulk upload updates four adjacent instances without per-item calls.
		this.instancedLine.setInstanceValues( 'instanceOffset', this.instanceBlockOffsets, INSTANCE_BLOCK_START )

		this.cssRenderer?.render( stage3d.scene, stage3d.camera )
	}

	onResize = () => {
		this.applyLayout()
		this.cssRenderer?.setSize( stage.width, stage.height )
		this.lines.forEach( line => line.resize( stage.width, stage.height ) )
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )

		this.groups.forEach( group => stage3d.remove( group ) )
		this.lines.forEach( line => line.dispose() )
		this.labels.forEach( label => label.element.remove() )
		this.cssRenderer?.domElement.remove()
		this.hud?.remove()
		this.hudStyle?.remove()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.lines = []
		this.groups = []
		this.labels = []
		this.cssRenderer = null
		this.control = null
		this.hud = null
		this.hudStyle = null
		this.arcLine = null
		this.localLine = null
		this.instancedLine = null
	}
}

export default V2UpdatesExample
