/**
 * Ricefield — QuadTree terrain wireframe and about 36,000 interactive instanced rice stalks.
 * Demonstrates: .instances( count ) fed by storage buffers, wind through .positionFn( fn ) and
 * .colorFn( fn ), .widthFn( fn ), and a compute pass that cuts the rice around the cursor.
 * The generative farmsteads around the paddies are .surface() ribbons and billboard lines.
 */
import { animate, utils } from 'animejs'
import { MeshLine, rectanglePositions, straightLine } from 'makio-meshline'
import { clamp, Fn, If, instanceIndex, normalize, pow, sin, smoothstep, storage, time, uniform, vec2, vec3 } from 'three/tsl'
import { MathUtils, Plane, Raycaster, RepeatWrapping, StorageInstancedBufferAttribute, TextureLoader, Vector2, Vector3 } from 'three/webgpu'

import QuadTree from '@/makio/generative/QuadTree'
import stage3d from '@/makio/three/stage3d'
import { mouse, onClick, onMove } from '@/makio/utils/input/mouse'
import { smoothstep as linearRamp } from '@/makio/utils/math'
import random from '@/makio/utils/random'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoControls, onShortcut } from '@/utils/demoControls'
import { createDemoHint } from '@/utils/demoHint'
import { createWater, SKY_HORIZON, skyBackground, WIND_DIRECTION } from '@/utils/ricefieldScenery'
import { bundColorFn, FIELD_HEIGHT, FIELD_WIDTH, riceNodes, STALK_HEIGHT, stalkColorFn } from '@/utils/ricefieldShading'
import { createVillage } from '@/utils/ricefieldVillage'

// A paddy's rice and border both stop this far from the edge of its quadtree cell.
const PADDY_MARGIN = 0.8
const STALK_SPACING = 0.3
const STALK_JITTER = 0.1
// The opening camera's azimuth: the village leaves this side of the paddies open.
const OPENING_THETA = 0.5
const BLOOM = {
	hd: { strength: 0.18, radius: 0.42, threshold: 0.9 },
	ultra: { strength: 0.25, radius: 0.48, threshold: 0.88 },
}

const raycaster = new Raycaster()
const pointer = new Vector2()
const groundPlane = new Plane( new Vector3( 0, 1, 0 ) )
const _intersectPoint = new Vector3()

function requestedQuality() {
	const params = new URLSearchParams( window.location.search )
	return params.get( 'quality' ) === 'ultra' || params.has( 'ultra' ) ? 'ultra' : 'hd'
}

/** Where the cursor ray meets the ground, or null when it points at the sky. */
function pickGround() {
	pointer.set( mouse.normalizedX, -mouse.normalizedY )
	raycaster.setFromCamera( pointer, stage3d.camera )
	return raycaster.ray.intersectPlane( groundPlane, _intersectPoint )
}

/** A quadtree cell as a paddy: centered in the world, its size inside the margin. */
const toPaddy = ( { x, y, width, height } ) => ( {
	x: x + ( width - FIELD_WIDTH ) / 2,
	z: y + ( height - FIELD_HEIGHT ) / 2,
	width: width - PADDY_MARGIN * 2,
	height: height - PADDY_MARGIN * 2,
} )

/** A jittered grid of stalks, centered in the paddy. */
function riceInPaddy( paddy ) {
	const countX = Math.floor( paddy.width / STALK_SPACING )
	const countZ = Math.floor( paddy.height / STALK_SPACING )
	// About half of the paddies keep the base color, the others are shaded by 0.4 to 1.2.
	const darkness = random() > 0.5 ? random( 0.4, 1.2 ) : 1
	const stalks = []
	for ( let x = 0; x < countX; x++ ) {
		for ( let z = 0; z < countZ; z++ ) {
			stalks.push( {
				x: paddy.x + ( x - ( countX - 1 ) / 2 ) * STALK_SPACING + random( -0.5, 0.5 ) * STALK_JITTER,
				z: paddy.z + ( z - ( countZ - 1 ) / 2 ) * STALK_SPACING + random( -0.5, 0.5 ) * STALK_JITTER,
				scale: random( 2.5, 4 ) / STALK_HEIGHT,
				darkness,
			} )
		}
	}
	return stalks
}

/** rectanglePositions() draws in the XY plane: lay it flat around the paddy. */
function paddyBorder( { x, z, width, height } ) {
	const border = rectanglePositions( width, height, 4 )
	for ( let i = 0; i < border.length; i += 3 ) {
		border.set( [border[i] + x, 0.02, border[i + 1] + z], i )
	}
	return border
}

function stalkPositionFn( rice, isUltra ) {
	const { colorVariation, finalScale, gust, gustAlong, instanceTransform, scaleInfluence, windDirection, windStrength } = rice

	return Fn( ( [position] ) => {
		const scaledY = position.y.mul( finalScale )

		// The wind bends the top of a stalk the most, and the small rice the least.
		const heightFactor = position.y.div( STALK_HEIGHT )
		const bend = heightFactor.mul( heightFactor ).mul( scaleInfluence )
		const windDisplacement = bend.mul( windStrength )
		const gustDisplacement = bend.mul( gust ).mul( 1.35 )

		const finalX = instanceTransform.x.add( windDirection.x.mul( windDisplacement ) ).add( gustDisplacement.mul( WIND_DIRECTION.x ) )
		const finalZ = instanceTransform.z.add( windDirection.y.mul( windDisplacement ) ).add( gustDisplacement.mul( WIND_DIRECTION.y ) )
		// Bent blades dip a little, so a gust front visibly flattens the rice.
		const finalY = scaledY.sub( gustDisplacement.mul( 0.35 ) )

		if ( !isUltra ) return vec3( finalX, finalY, finalZ )

		// ULTRA HD: Smooth panicle arch (heavy grain ears bow over near the tip)
		// plus a secondary high-frequency tip flutter in the wind.
		const panicleArch = pow( smoothstep( 0.42, 1, heightFactor ), 1.85 ).mul( scaleInfluence )
		const flutterPhase = time.mul( 5.2 ).add( colorVariation.mul( 6.28 ) ).add( gustAlong.mul( 0.4 ) )
		const tipFlutter = sin( flutterPhase ).mul( 0.08 ).mul( panicleArch ).mul( gust.add( 0.35 ) )
		const archDir = normalize( windDirection.add( vec2( WIND_DIRECTION ).mul( 0.65 ) ) )
		const ultraX = finalX.add( archDir.x.mul( panicleArch.mul( 0.38 ).add( tipFlutter ) ) )
		const ultraZ = finalZ.add( archDir.y.mul( panicleArch.mul( 0.38 ).add( tipFlutter ) ) )
		const ultraY = finalY.sub( panicleArch.mul( 0.22 ) )

		return vec3( ultraX, ultraY, ultraZ )
	} )
}

export default class RicefieldExample {
	quality = requestedQuality()
	mouseUniform = uniform( new Vector3( 1000, 0, 1000 ) ) // far away until the cursor moves
	shockwaveOrigin = uniform( new Vector3() )
	cutRing = uniform( new Vector2() ) // inner (x) and outer (y) radius of the shockwave
	mouseSpeedUniform = uniform( 1 )
	areaOfEffectUniform = uniform( 1 )
	mouseSpeed = 0

	async init() {
		await stage3d.initRender( { background: SKY_HORIZON, far: 1600 } )
		// Low over the paddies and facing the sun, so the canals mirror the sky.
		stage3d.orbit( 56, {
			target: [0, 6.5, 0],
			phi: 1.2,
			theta: OPENING_THETA,
			minPhi: 0.1,
			maxPhi: Math.PI * 0.45,
			minRadius: 20,
			maxRadius: 100,
		} )
		this.bloomPass = createBloomPipeline( BLOOM[this.quality] ).bloomPass

		this.noiseTexture = stage3d.own( new TextureLoader().load( '/textures/noises/perlin/rgb-256x256.png' ) )
		this.noiseTexture.wrapS = RepeatWrapping
		this.noiseTexture.wrapT = RepeatWrapping

		this.paddies = new QuadTree( FIELD_WIDTH, FIELD_HEIGHT, { jitter: 0.4, total: 14 } ).compute().map( toPaddy )
		this.plantRice()
		this.buildVillage()
		this.createVisuals()
		this.createCompute()
		this.createControls()

		this.hint = createDemoHint( 'Move to part the rice · click for a shockwave · toggle Ultra HD', { accent: '#fbbf24', hideAfter: 10000 } )
		stage3d.listen( onMove, this.onMouseMove )
		stage3d.listen( onClick, this.onMouseClick )
		stage3d.own( () => utils.remove( this.cutRing.value ) )
	}

	plantRice() {
		const stalks = this.paddies.flatMap( riceInPaddy )
		this.stalkCount = stalks.length

		// Shared across HD / Ultra HD, and they must exist before the MeshLine hooks reference them.
		this.scaleStorageBuffer = stage3d.own( new StorageInstancedBufferAttribute( stalks.length, 2 ) )
		this.transformStorageBuffer = stage3d.own( new StorageInstancedBufferAttribute( stalks.length, 4 ) )
		stalks.forEach( ( { x, z, scale, darkness }, i ) => {
			this.scaleStorageBuffer.setXY( i, 1, darkness )
			this.transformStorageBuffer.setXYZW( i, x, 0, z, scale )
		} )
	}

	buildVillage() {
		this.village = createVillage( this.noiseTexture, { clearAzimuth: OPENING_THETA } )
		stage3d.add( this.village )
	}

	newVillage = () => this.village.grow()

	// Everything the quality mode changes. The rice data and the compute survive a switch.
	createVisuals() {
		const isUltra = this.quality === 'ultra'
		stage3d.scene.backgroundNode = skyBackground( this.noiseTexture, isUltra )
		this.water = createWater( this.noiseTexture, isUltra )
		stage3d.add( this.water )
		this.createStalks( isUltra )
		this.createBorders( isUltra )
	}

	createStalks( isUltra ) {
		const rice = riceNodes( this.transformStorageBuffer, this.scaleStorageBuffer, this.noiseTexture )

		this.stalks = new MeshLine()
			.lines( straightLine( STALK_HEIGHT, isUltra ? 5 : 2, true ) )
			.instances( this.stalkCount )
			.lineWidth( 0.1 )
			.widthCallback( t => 1 - linearRamp( 0.4, 1, t ) )
			.colorFn( stalkColorFn( rice, isUltra ) )
			.widthFn( Fn( ( [width] ) => width.mul( rice.widthMultiplier ) ) )
			.positionFn( stalkPositionFn( rice, isUltra ) )
			.autoResize()

		stage3d.add( this.stalks )
	}

	createBorders( isUltra ) {
		this.borders = new MeshLine()
			.lines( this.paddies.map( paddyBorder ), true )
			.color( 0x8E6A40 ) // sunlit earth
			.lineWidth( isUltra ? 0.18 : 0.15 )
			.miterLimit( 8 )
			.autoResize()

		if ( isUltra ) this.borders.colorFn( bundColorFn( this.noiseTexture ) )
		stage3d.add( this.borders )
	}

	createCompute() {
		const currentScale = storage( this.scaleStorageBuffer ).element( instanceIndex ).x
		const instancePos = storage( this.transformStorageBuffer ).element( instanceIndex )

		this.computeUpdate = stage3d.own( Fn( () => {
			const worldPos = vec3( instancePos.x, 0, instancePos.z )
			const mouseDist = worldPos.distance( this.mouseUniform )
			const shockwaveDist = worldPos.distance( this.shockwaveOrigin )
			const withinShockwave = shockwaveDist.greaterThanEqual( this.cutRing.x ).and( shockwaveDist.lessThanEqual( this.cutRing.y ) )

			If( withinShockwave, () => {
				currentScale.assign( 0.01 )
			} ).Else( () => {
				// Falloff from 1 to 5 units, widened by the speed of the cursor.
				const reach = this.mouseSpeedUniform.mul( this.areaOfEffectUniform )
				const targetScale = smoothstep( reach, reach.mul( 5 ), mouseDist ).mul( 0.99 ).add( 0.01 )

				// Shrink instantly near the cursor, regrow linearly up to half height, then ease out.
				If( targetScale.lessThan( currentScale ), () => {
					currentScale.assign( targetScale )
				} ).ElseIf( currentScale.lessThan( 0.5 ), () => {
					currentScale.addAssign( targetScale.sub( currentScale ).mul( 0.0016 ) )
				} ).Else( () => {
					currentScale.addAssign( targetScale.sub( currentScale ).mul( 0.05 ) )
				} )
			} )

			currentScale.assign( clamp( currentScale, 0.01, 1 ) )
		} )().compute( this.stalkCount ) )
	}

	createControls() {
		this.controls = createDemoControls( [
			{ id: 'hd', label: 'HD', title: 'HD: standard golden-hour paddy scene (U)', onClick: () => this.setQuality( 'hd' ) },
			{ id: 'ultra', label: 'Ultra HD', title: 'Ultra HD: sun reflection path, crepuscular rays, curved 6-segment stalks & anisotropic leaf sheen (U)', onClick: () => this.setQuality( 'ultra' ) },
			'divider',
			{ id: 'village', label: 'New village', key: 'R', title: 'Raise a new village around the paddies (R)', onClick: this.newVillage },
		], { accent: '#fbbf24', label: 'Visual quality mode' } )

		this.showQuality()
		onShortcut( 'u', () => this.setQuality( this.quality === 'ultra' ? 'hd' : 'ultra' ) )
	}

	setQuality( quality ) {
		if ( quality === this.quality ) return
		this.quality = quality
		this.stalks.dispose()
		this.borders.dispose()
		this.water.dispose()
		this.createVisuals()
		for ( const [name, value] of Object.entries( BLOOM[quality] ) ) this.bloomPass[name].value = value
		this.showQuality()
	}

	// select() would also mark the New village action as a released toggle.
	showQuality() {
		this.controls.setPressed( 'hd', this.quality === 'hd' )
		this.controls.setPressed( 'ultra', this.quality === 'ultra' )
	}

	onMouseMove = () => {
		const hit = pickGround()
		if ( hit ) this.mouseUniform.value.copy( hit )
	}

	onMouseClick = () => {
		const hit = pickGround()
		if ( hit ) this.createShockwave( hit )
		this.hint.hide()
	}

	createShockwave( { x, z } ) {
		const ring = this.cutRing.value
		utils.remove( ring )
		this.shockwaveOrigin.value.set( x, 0, z )

		animate( ring, {
			x: { from: 1, to: 70 },
			y: { from: 6, to: 95 },
			duration: 1.1,
			ease: 'inOutQuad',
			onComplete: () => ring.set( 0, 0 ),
		} )
		// animate() writes the from values at once: the ring stays closed until its first tick.
		ring.set( 0, 0 )
	}

	update = dt => {
		stage3d.renderer.compute( this.computeUpdate )

		const distance = Math.hypot( mouse.moveX, mouse.moveY )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, distance / ( dt / 16 || 1 ), 0.15 )
		this.mouseSpeedUniform.value = MathUtils.clamp( 1 + this.mouseSpeed * 0.1, 1, 3 )

		// The area of effect grows back while the cursor moves and fades once it rests.
		const area = this.areaOfEffectUniform
		area.value = distance > 1 ? MathUtils.lerp( area.value, 1, 0.15 ) : area.value * 0.95
	}
}
