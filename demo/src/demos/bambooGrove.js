import { MeshLine } from 'makio-meshline'
import { attribute, cameraPosition, color, cos, dot, Fn, fract, max, mix, normalize, positionWorldDirection, pow, sin, smoothstep, texture, uniform, uv, vec3, vec4 } from 'three/tsl'
import { DirectionalLight, Fog, HemisphereLight, Mesh, MeshStandardNodeMaterial, PCFSoftShadowMap, PlaneGeometry, RepeatWrapping, TextureLoader, Vector3 } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { random } from '@/makio/utils/random'
import { createDemoHint } from '@/utils/demoHint'

// A misty grove: deep greens fading into a sage haze, a bright canopy overhead.
const MIST = 0x93AC82
const CANOPY_LIGHT = 0xEEF2D2
const FOG_NEAR = 9
const FOG_FAR = 44
const CLUMP_COUNT = 16
const GROVE_RADIUS = 8.5
const NODE_SPACING = 1.1
const LEAF_POINTS = 7
// Horizontal sway at 12 m; it grows with the square of the height.
const SWAY = 0.34
const SWAY_REFERENCE_HEIGHT = 12
const AUTO_ROTATE_SPEED = 0.00003

const hash = Fn( ( [value] ) => fract( sin( value.mul( 12.9898 ).add( 7.13 ) ).mul( 43758.5453 ) ) )

class BambooGroveExample {
	constructor() {
		this.stalksMesh = null
		this.nodesMesh = null
		this.twigsMesh = null
		this.leavesMesh = null
		this.light = null
		this.hemisphereLight = null
		this.ground = null
		this.noise = null
		this.hint = null
		this.time = 0
		this.swayTime = uniform( 0 )
		this.sunDirection = uniform( new Vector3( 0.6, 0.7, 0.4 ).normalize() )
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
	}

	async init() {
		await stage3d.initRender( { background: MIST } )
		stage3d.renderer.shadowMap.enabled = true
		stage3d.renderer.shadowMap.type = PCFSoftShadowMap
		stage3d.renderer.shadowMap.transmitted = true

		// Standing among the culms at eye height, looking up into the leaves. The
		// control orbits `cameraOffset` and only aims at `target`, so the orbit
		// centre is lifted to eye level and phi keeps the camera above the moss.
		stage3d.control = new OrbitControl( stage3d.camera, 14 )
		stage3d.control.cameraOffset.set( 0, 2.2, 0 )
		stage3d.control.target.set( 0, 4.6, 0 )
		stage3d.control._phi = 1.62
		stage3d.control.minPhi = 1.25
		stage3d.control.maxPhi = 1.68
		stage3d.control.maxRadius = 20
		stage3d.control.minRadius = 6

		this.noise = new TextureLoader().load( '/textures/noises/perlin/rgb-256x256.png' )
		this.noise.wrapS = RepeatWrapping
		this.noise.wrapT = RepeatWrapping

		this.initAtmosphere()
		this.initLights()
		this.initGround()
		const counts = this.createBamboo()
		this.hint = createDemoHint( `${counts.stalks} culms · ${counts.leaves} leaves · 4 instanced draws`, { accent: '#a3e635', hideAfter: 9000 } )

		stage.onUpdate.add( this.update )
	}

	initAtmosphere() {
		stage3d.scene.backgroundNode = Fn( () => {
			const direction = positionWorldDirection.normalize()
			const sky = mix( color( MIST ), color( CANOPY_LIGHT ), smoothstep( -0.05, 0.6, direction.y ) )
			const sunGlow = pow( max( dot( direction, this.sunDirection ), 0 ), 10 ).mul( 0.3 )
			return vec4( sky.add( color( 0xFFF1C8 ).mul( sunGlow ) ), 1 )
		} )()
		stage3d.scene.fog = new Fog( MIST, FOG_NEAR, FOG_FAR )
	}

	initLights() {
		this.hemisphereLight = new HemisphereLight( 0xE4F0CC, 0x2E3A1E, 1.6 )
		stage3d.add( this.hemisphereLight )

		this.light = new DirectionalLight( 0xFFEBC8, 3.4 )
		this.light.position.set( 8, 16, 8 )
		this.light.castShadow = true

		this.light.shadow.mapSize.set( 2048, 2048 )
		this.light.shadow.camera.near = 0.5
		this.light.shadow.camera.far = 60
		this.light.shadow.bias = -0.0003
		this.light.shadow.radius = 3
		this.light.shadow.camera.left = -16
		this.light.shadow.camera.right = 16
		this.light.shadow.camera.top = 16
		this.light.shadow.camera.bottom = -16
		this.light.shadow.autoUpdate = false
		this.light.shadow.needsUpdate = true

		this.light.target.position.set( 0, 3, 0 )
		stage3d.add( this.light.target )
		stage3d.add( this.light )
	}

	initGround() {
		// Moss and leaf litter from two octaves of the shared noise texture.
		const material = new MeshStandardNodeMaterial( { roughness: 0.95, metalness: 0 } )
		const coordinate = uv().mul( 7 )
		const litter = texture( this.noise, coordinate ).r.mul( 0.6 ).add( texture( this.noise, coordinate.mul( 3.3 ) ).g.mul( 0.4 ) )
		material.colorNode = mix( color( 0x34461F ), color( 0x75653A ), smoothstep( 0.38, 0.72, litter ) )

		this.ground = new Mesh( new PlaneGeometry( 80, 80 ), material )
		this.ground.rotation.x = -Math.PI / 2
		this.ground.receiveShadow = true
		stage3d.add( this.ground )
	}

	createBamboo() {
		const { stalks, nodes, twigs, leaves } = this.createBambooData()

		// Shared by every layer: culms, rings, twigs and leaves sway together
		// because they evaluate the same offset for the same stalk and height.
		const swayOffset = Fn( ( [phase, height] ) => {
			const reach = height.div( SWAY_REFERENCE_HEIGHT )
			const amount = reach.mul( reach ).mul( SWAY )
			return vec3(
				sin( this.swayTime.add( phase ) ),
				0,
				cos( this.swayTime.mul( 0.83 ).add( phase.mul( 1.37 ) ) ),
			).mul( amount )
		} )

		this.createStalksMesh( stalks, swayOffset )
		this.createNodesMesh( nodes, swayOffset )
		this.createTwigsMesh( twigs, swayOffset )
		this.createLeavesMesh( leaves, swayOffset )
		return { stalks: stalks.length, leaves: leaves.length }
	}

	createBambooData() {
		const stalks = []
		const nodes = []
		const twigs = []
		const leaves = []

		const addLeaf = ( x, y, z, azimuth, pitch, length, stalk ) => {
			leaves.push( {
				x, y, z,
				dirX: Math.cos( azimuth ) * Math.cos( pitch ),
				dirY: Math.sin( pitch ),
				dirZ: Math.sin( azimuth ) * Math.cos( pitch ),
				length,
				flutter: random( 0, Math.PI * 2 ),
				phase: stalk.phase,
				droop: random( 0.15, 0.45 ),
			} )
		}

		// Bamboo grows in clumps: a few culms around each clump centre, leaning
		// slightly outward.
		for ( let clump = 0; clump < CLUMP_COUNT; clump++ ) {
			const clumpAngle = random( 0, Math.PI * 2 )
			const clumpRadius = Math.sqrt( random( 0, 1 ) ) * GROVE_RADIUS
			const clumpX = Math.cos( clumpAngle ) * clumpRadius
			const clumpZ = Math.sin( clumpAngle ) * clumpRadius
			const culms = Math.round( random( 3, 7 ) )

			for ( let culm = 0; culm < culms; culm++ ) {
				const offsetAngle = random( 0, Math.PI * 2 )
				const offsetRadius = random( 0.15, 0.95 )
				const leanAngle = offsetAngle + random( -0.4, 0.4 )
				const stalk = {
					x: clumpX + Math.cos( offsetAngle ) * offsetRadius,
					z: clumpZ + Math.sin( offsetAngle ) * offsetRadius,
					height: random( 7.5, 13 ),
					width: random( 0.07, 0.15 ),
					lean: random( 0.2, 1 ),
					leanDirX: Math.cos( leanAngle ),
					leanDirZ: Math.sin( leanAngle ),
					phase: random( 0, Math.PI * 2 ),
				}
				stalks.push( stalk )

				const rest = y => {
					const fraction = y / stalk.height
					const leanAmount = stalk.lean * fraction * fraction
					return [stalk.x + stalk.leanDirX * leanAmount, y, stalk.z + stalk.leanDirZ * leanAmount]
				}

				const nodeCount = Math.floor( stalk.height / NODE_SPACING )
				for ( let nodeIndex = 1; nodeIndex < nodeCount; nodeIndex++ ) {
					const y = nodeIndex * NODE_SPACING
					const [nodeX, , nodeZ] = rest( y )
					nodes.push( { x: nodeX, y, z: nodeZ, size: stalk.width * 0.8, widthMult: stalk.width * 10.4, phase: stalk.phase } )

					// Branches and foliage fill the upper part of the culm only.
					if ( y / stalk.height < 0.42 ) continue
					const twigCount = random() < 0.7 ? 1 : 2
					for ( let twigIndex = 0; twigIndex < twigCount; twigIndex++ ) {
						const azimuth = random( 0, Math.PI * 2 )
						const elevation = random( 0.1, 0.55 )
						const length = random( 0.6, 1.5 ) * ( 1.15 - y / stalk.height * 0.4 )
						const dirX = Math.cos( azimuth ) * Math.cos( elevation )
						const dirY = Math.sin( elevation )
						const dirZ = Math.sin( azimuth ) * Math.cos( elevation )
						const end = [nodeX + dirX * length, y + dirY * length, nodeZ + dirZ * length]
						twigs.push( { start: [nodeX, y, nodeZ], end, phase: stalk.phase } )

						const leafCount = Math.round( random( 3, 6 ) )
						for ( let leafIndex = 0; leafIndex < leafCount; leafIndex++ ) {
							const along = random( 0.45, 1 )
							addLeaf(
								nodeX + ( end[0] - nodeX ) * along,
								y + ( end[1] - y ) * along,
								nodeZ + ( end[2] - nodeZ ) * along,
								azimuth + random( -1.1, 1.1 ),
								random( -0.6, 0.15 ),
								random( 0.45, 0.85 ),
								stalk,
							)
						}
					}
				}

				// A crown of leaves fanning out from the tip.
				const [topX, topY, topZ] = rest( stalk.height )
				const crown = Math.round( random( 5, 8 ) )
				for ( let leafIndex = 0; leafIndex < crown; leafIndex++ ) {
					addLeaf( topX, topY, topZ, random( 0, Math.PI * 2 ), random( -0.25, 0.5 ), random( 0.5, 0.9 ), stalk )
				}
			}
		}

		return { stalks, nodes, twigs, leaves }
	}

	createStalkTemplate( segments = 30 ) {
		const points = new Float32Array( segments * 3 )

		for ( let i = 0; i < segments; i++ ) {
			const t = i / ( segments - 1 )
			points[i * 3] = 0
			points[i * 3 + 1] = t
			points[i * 3 + 2] = 0
		}

		return points
	}

	createRingTemplate( segments = 8 ) {
		const points = new Float32Array( segments * 3 )

		for ( let i = 0; i < segments; i++ ) {
			const angle = i / segments * Math.PI * 2
			points[i * 3] = Math.cos( angle )
			points[i * 3 + 1] = 0
			points[i * 3 + 2] = Math.sin( angle )
		}

		return points
	}

	/** Points along +X from 0 to 1, for twigs and leaves placed by positionFn. */
	createSpanTemplate( segments ) {
		const points = new Float32Array( segments * 3 )
		for ( let i = 0; i < segments; i++ ) points[i * 3] = i / ( segments - 1 )
		return points
	}

	createStalksMesh( stalksData, swayOffset ) {
		this.stalksMesh = new MeshLine()
			.lines( this.createStalkTemplate(), false )
			.instances( stalksData.length )
			.color( 0x497849 )
			.lineWidth( 0.1 )
			.shadow( true )
			.positionFn( Fn( ( [position] ) => {
				const transform = attribute( 'instanceTransform', 'vec4' )
				const lean = attribute( 'instanceLean', 'vec4' )
				const fraction = position.y
				const y = fraction.mul( transform.z )
				const leanAmount = lean.x.mul( fraction.mul( fraction ) )
				const px = transform.x.add( lean.y.mul( leanAmount ) )
				const pz = transform.y.add( lean.z.mul( leanAmount ) )

				return vec3( px, y, pz ).add( swayOffset( lean.w, y ) )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const transform = attribute( 'instanceTransform', 'vec4' )
				return width.mul( transform.w )
			} ) )
			.colorFn( Fn( ( [, progress, side] ) => {
				const lean = attribute( 'instanceLean', 'vec4' )
				// Culms range from deep green to a sunnier yellow-green; the lit
				// side and the dusty sheath at the base sell the cylinder.
				const culm = mix( color( 0x355F25 ), color( 0x86973A ), hash( lean.w ).mul( 0.7 ) )
				const shade = side.mul( 0.35 ).add( 0.65 )
				const sheath = smoothstep( 0.03, 0.12, progress ).oneMinus().mul( 0.45 )
				return vec4( mix( culm.mul( shade ), color( 0x8F8566 ), sheath ), 1 )
			} ) )

		this.stalksMesh.material.castShadowNode = vec4( 0.25, 0.27, 0.22, 1 )

		this.stalksMesh.addInstanceAttributes( {
			instanceTransform: 4,
			instanceLean: 4,
		} )

		const transforms = new Float32Array( stalksData.length * 4 )
		const leans = new Float32Array( stalksData.length * 4 )
		for ( let i = 0; i < stalksData.length; i++ ) {
			const s = stalksData[ i ]
			const offset = i * 4
			transforms[offset] = s.x
			transforms[offset + 1] = s.z
			transforms[offset + 2] = s.height
			transforms[offset + 3] = s.width / 0.1

			leans[offset] = s.lean
			leans[offset + 1] = s.leanDirX
			leans[offset + 2] = s.leanDirZ
			leans[offset + 3] = s.phase
		}
		this.stalksMesh.setInstanceValues( 'instanceTransform', transforms )
		this.stalksMesh.setInstanceValues( 'instanceLean', leans )

		stage3d.add( this.stalksMesh )
	}

	createNodesMesh( nodesData, swayOffset ) {
		if ( nodesData.length === 0 ) return

		this.nodesMesh = new MeshLine()
			.lines( this.createRingTemplate(), true )
			.instances( nodesData.length )
			.needsProgress( false )
			.color( 0x2d4a2d )
			.lineWidth( 0.05 )
			.shadow( true )
			.positionFn( Fn( ( [position] ) => {
				const pos = attribute( 'instancePosition', 'vec3' )
				const shape = attribute( 'instanceShape', 'vec3' )

				return vec3(
					position.x.mul( shape.x ).add( pos.x ),
					pos.y,
					position.z.mul( shape.x ).add( pos.z )
				).add( swayOffset( shape.z, pos.y ) )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				return width.mul( attribute( 'instanceShape', 'vec3' ).y )
			} ) )

		this.nodesMesh.material.castShadowNode = vec4( 0.25, 0.27, 0.22, 1 )

		this.nodesMesh.addInstanceAttributes( {
			instancePosition: 3,
			instanceShape: 3,
		} )

		const positions = new Float32Array( nodesData.length * 3 )
		const shapes = new Float32Array( nodesData.length * 3 )
		for ( let i = 0; i < nodesData.length; i++ ) {
			const n = nodesData[ i ]
			const offset = i * 3
			positions[offset] = n.x
			positions[offset + 1] = n.y
			positions[offset + 2] = n.z
			shapes[offset] = n.size
			shapes[offset + 1] = n.widthMult
			shapes[offset + 2] = n.phase
		}
		this.nodesMesh.setInstanceValues( 'instancePosition', positions )
		this.nodesMesh.setInstanceValues( 'instanceShape', shapes )

		stage3d.add( this.nodesMesh )
	}

	createTwigsMesh( twigsData, swayOffset ) {
		if ( twigsData.length === 0 ) return

		this.twigsMesh = new MeshLine()
			.lines( this.createSpanTemplate( 3 ), false )
			.instances( twigsData.length )
			.color( 0x4F6A2C )
			.lineWidth( 0.035 )
			.widthCallback( progress => 1 - progress * 0.6 )
			.shadow( true )
			.positionFn( Fn( ( [position] ) => {
				const start = attribute( 'twigStart', 'vec3' )
				const end = attribute( 'twigEnd', 'vec4' )
				const point = mix( start, end.xyz, position.x )
				return point.add( swayOffset( end.w, point.y ) )
			} ) )

		this.twigsMesh.material.castShadowNode = vec4( 0.35, 0.37, 0.3, 1 )

		this.twigsMesh.addInstanceAttributes( {
			twigStart: 3,
			twigEnd: 4,
		} )

		const starts = new Float32Array( twigsData.length * 3 )
		const ends = new Float32Array( twigsData.length * 4 )
		for ( let i = 0; i < twigsData.length; i++ ) {
			const twig = twigsData[i]
			starts.set( twig.start, i * 3 )
			ends.set( twig.end, i * 4 )
			ends[i * 4 + 3] = twig.phase
		}
		this.twigsMesh.setInstanceValues( 'twigStart', starts )
		this.twigsMesh.setInstanceValues( 'twigEnd', ends )

		stage3d.add( this.twigsMesh )
	}

	createLeavesMesh( leavesData, swayOffset ) {
		if ( leavesData.length === 0 ) return

		this.leavesMesh = new MeshLine()
			.lines( this.createSpanTemplate( LEAF_POINTS ), false )
			.instances( leavesData.length )
			.color( 0x4F7F2A )
			.lineWidth( 0.15 )
			// Lanceolate: a thin stalk, the widest point near the base, a long tip.
			.widthCallback( progress => Math.pow( Math.sin( Math.PI * progress ), 0.7 ) * ( 1 - progress * 0.5 ) )
			.shadow( true )
			.positionFn( Fn( ( [position] ) => {
				const origin = attribute( 'leafOrigin', 'vec3' )
				const direction = attribute( 'leafDirection', 'vec3' )
				const shape = attribute( 'leafShape', 'vec4' )
				const t = position.x
				// Each leaf flutters on its own, on top of its culm's sway.
				const flutter = sin( this.swayTime.mul( 2.4 ).add( shape.y ) ).mul( 0.2 )
					.add( sin( this.swayTime.mul( 4.3 ).add( shape.y.mul( 2.1 ) ) ).mul( 0.08 ) )
				const heading = normalize( direction.add( vec3( flutter, flutter.mul( 0.4 ), flutter.negate() ) ) )
				const droop = vec3( 0, t.mul( t ).mul( shape.x ).mul( shape.w ), 0 )
				return origin.add( heading.mul( t.mul( shape.x ) ) ).sub( droop ).add( swayOffset( shape.z, origin.y ) )
			} ) )
			.colorFn( Fn( ( [, progress] ) => {
				const origin = attribute( 'leafOrigin', 'vec3' )
				const shape = attribute( 'leafShape', 'vec4' )
				const seed = hash( shape.y )
				const green = mix( color( 0x2A5419 ), color( 0x7DA536 ), seed )
				const ripe = mix( green, color( 0xB4B055 ), smoothstep( 0.55, 1, progress ).mul( seed.mul( 0.5 ) ) )
				// Leaves between the camera and the sun glow through.
				const towardSun = max( dot( normalize( origin.sub( cameraPosition ) ), this.sunDirection ), 0 )
				const glow = color( 0xC8E27A ).mul( pow( towardSun, 3 ).mul( 0.5 ) )
				return vec4( ripe.add( glow ), 1 )
			} ) )

		// Leaves let a little green light through, so their shadows stay soft.
		this.leavesMesh.material.castShadowNode = vec4( 0.3, 0.38, 0.22, 1 )

		this.leavesMesh.addInstanceAttributes( {
			leafOrigin: 3,
			leafDirection: 3,
			leafShape: 4,
		} )

		const origins = new Float32Array( leavesData.length * 3 )
		const directions = new Float32Array( leavesData.length * 3 )
		const shapes = new Float32Array( leavesData.length * 4 )
		for ( let i = 0; i < leavesData.length; i++ ) {
			const leaf = leavesData[i]
			origins[i * 3] = leaf.x
			origins[i * 3 + 1] = leaf.y
			origins[i * 3 + 2] = leaf.z
			directions[i * 3] = leaf.dirX
			directions[i * 3 + 1] = leaf.dirY
			directions[i * 3 + 2] = leaf.dirZ
			shapes[i * 4] = leaf.length
			shapes[i * 4 + 1] = leaf.flutter
			shapes[i * 4 + 2] = leaf.phase
			shapes[i * 4 + 3] = leaf.droop
		}
		this.leavesMesh.setInstanceValues( 'leafOrigin', origins )
		this.leavesMesh.setInstanceValues( 'leafDirection', directions )
		this.leavesMesh.setInstanceValues( 'leafShape', shapes )

		stage3d.add( this.leavesMesh )
	}

	update = ( dt ) => {
		const delta = Math.min( dt, 100 ) * 0.001
		this.time += delta
		this.swayTime.value += delta * ( this.reducedMotion ? 0.2 : 0.9 )

		// The sun drifts slowly around the grove so the dappled shadows move.
		const angle = this.time * 0.05 + 0.6
		this.light.position.set( Math.cos( angle ) * 12, 16, Math.sin( angle ) * 12 )
		this.sunDirection.value.copy( this.light.position ).sub( this.light.target.position ).normalize()
		this.light.shadow.needsUpdate = true

		const control = stage3d.control
		if ( control && !control._isDown && !this.reducedMotion ) control._theta += Math.min( dt, 100 ) * AUTO_ROTATE_SPEED
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		this.hint?.remove()
		this.hint = null

		stage3d.scene.backgroundNode = null
		stage3d.scene.fog = null

		if ( this.ground ) {
			stage3d.remove( this.ground )
			this.ground.geometry.dispose()
			this.ground.material.dispose()
			this.ground = null
		}

		for ( const key of ['stalksMesh', 'nodesMesh', 'twigsMesh', 'leavesMesh'] ) {
			if ( !this[key] ) continue
			stage3d.remove( this[key] )
			this[key].dispose()
			this[key] = null
		}

		if ( this.light ) {
			stage3d.remove( this.light.target )
			stage3d.remove( this.light )
			this.light.shadow?.map?.dispose()
			this.light.dispose()
			this.light = null
		}

		if ( this.hemisphereLight ) {
			stage3d.remove( this.hemisphereLight )
			this.hemisphereLight.dispose()
			this.hemisphereLight = null
		}

		this.noise?.dispose()
		this.noise = null

		stage3d.renderer.shadowMap.enabled = false
		stage3d.renderer.shadowMap.transmitted = false
		stage3d.control?.dispose()
	}

}

export default BambooGroveExample
