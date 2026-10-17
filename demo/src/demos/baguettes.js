import { MeshLine } from 'makio-meshline'
import { attribute, cameraPosition, clamp, color, dot, float, Fn, fract, max, mix, modelViewMatrix, normalize, positionGeometry, positionWorldDirection, pow, select, sin, smoothstep, sqrt, texture, time, uniform, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { CatmullRomCurve3, Fog, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import keyboard from '@/makio/utils/input/keyboard'
import random from '@/makio/utils/random'
import { createDemoHint } from '@/utils/demoHint'

const BAGUETTE_COUNT = 30
const SEGMENTS = 64
const BILLBOARD_VERTICES_PER_POINT = 4
const PATH_POINTS = 8
const SPREAD = 40
const BAGUETTE_LENGTH = 10
const FLIGHT_SPEED_MIN = 6
const FLIGHT_SPEED_MAX = 11
const AUTO_ROTATE_SPEED = 0.00004

// A bright summer sky: distant loaves melt into it instead of darkening.
const SKY_ZENITH = 0x2C6CD2
const SKY_HORIZON = 0xD5E7F6
const SKY_HAZE = 0xBFD9EF
const SUN_DIRECTION = new Vector3( 0.45, 0.5, -0.74 ).normalize()
const HUD_STYLE_ID = 'BaguetteShadingHudStyle'

// Stable per-loaf random in [0, 1) from the batched line index.
const hash = Fn( ( [value] ) => fract( sin( value.mul( 12.9898 ).add( 4.1 ) ).mul( 43758.5453 ) ) )

const vWorldPos = varyingProperty( 'vec3', 'vBaguetteWorldPos' )
const vScreenDir = varyingProperty( 'vec2', 'vBaguetteScreenDir' )
const vBake = varyingProperty( 'float', 'vBaguetteBake' )

function ensureHudStyle() {
	if ( typeof document === 'undefined' || document.getElementById( HUD_STYLE_ID ) ) return
	const style = document.createElement( 'style' )
	style.id = HUD_STYLE_ID
	style.textContent = `
		.BaguetteShadingHud {
			position: fixed;
			top: calc(18px + var(--sait, 0px));
			left: 50%;
			transform: translateX(-50%);
			z-index: 1000;
			display: inline-flex;
			align-items: center;
			gap: 3px;
			padding: 4px;
			border-radius: 999px;
			background: rgba(8, 12, 20, 0.72);
			border: 1px solid rgba(255, 255, 255, 0.14);
			box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			font: 650 11px/1 'Inter', system-ui, -apple-system, sans-serif;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			user-select: none;
		}
		.BaguetteShadingHud__btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			min-height: 30px;
			padding: 0 12px;
			border: 1px solid transparent;
			border-radius: 999px;
			background: transparent;
			color: rgba(244, 245, 247, 0.7);
			font: inherit;
			letter-spacing: inherit;
			text-transform: inherit;
			cursor: pointer;
			transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
		}
		.BaguetteShadingHud__btn:hover {
			color: #ffffff;
			background: rgba(255, 255, 255, 0.08);
		}
		.BaguetteShadingHud__btn.is-active {
			color: #fff8eb;
			background: rgba(245, 180, 83, 0.22);
			border-color: rgba(245, 180, 83, 0.52);
			box-shadow: 0 0 16px rgba(245, 180, 83, 0.2);
		}
		.BaguetteShadingHud__dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: currentColor;
			opacity: 0.55;
		}
		.BaguetteShadingHud__btn.is-active .BaguetteShadingHud__dot {
			background: #f5b453;
			box-shadow: 0 0 8px #f5b453;
			opacity: 1;
		}
		@media (max-width: 720px) {
			.BaguetteShadingHud {
				top: calc(12px + var(--sait, 0px));
				padding: 3px;
				font-size: 10px;
			}
			.BaguetteShadingHud__btn {
				min-height: 27px;
				padding: 0 10px;
			}
		}
	`
	document.head.appendChild( style )
}

class FlyingBaguettesExample {
	constructor() {
		const params = typeof window !== 'undefined' ? new URLSearchParams( window.location.search ) : null
		const requestedMode = params?.get( 'shading' ) || ( params?.has( 'flat' ) ? 'flat' : 'lit' )
		this.shadingMode = ['lit', 'flat', 'normals'].includes( requestedMode ) ? requestedMode : 'lit'
		// 0 = flat, 1 = 3D fake normals + lighting, 2 = fake normal visualization
		this.shadingModeUniform = uniform( this.shadingMode === 'flat' ? 0 : this.shadingMode === 'normals' ? 2 : 1 )

		this.curves = []
		this.baguettes = []
		this.lineArrays = []
		this.lineIndices = new Float32Array( SEGMENTS * BILLBOARD_VERTICES_PER_POINT * BAGUETTE_COUNT )
		this.line = null
		this.texture = null
		this.noise = null
		this.hint = null
		this.hud = null
		this.hudButtons = {}
		this.samplePoint = new Vector3()
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true

		let vertexOffset = 0
		for ( let lineIndex = 0; lineIndex < BAGUETTE_COUNT; lineIndex++ ) {
			const points = Array.from( { length: PATH_POINTS }, () => new Vector3(
				random( -SPREAD, SPREAD ),
				random( -SPREAD, SPREAD ),
				random( -SPREAD, SPREAD )
			) )
			const curve = new CatmullRomCurve3( points, true, 'catmullrom', 0.5 )
			const curveLength = curve.getLength()
			const baguette = {
				positions: new Float32Array( SEGMENTS * 3 ),
				progress: random( 0, 1 ),
				// World units per second, so long and short loops fly at a similar pace.
				speed: random( FLIGHT_SPEED_MIN, FLIGHT_SPEED_MAX ) / curveLength,
				curveLength,
			}

			this.curves.push( curve )
			this.baguettes.push( baguette )
			this.lineArrays.push( baguette.positions )

			for ( let i = 0; i < SEGMENTS * BILLBOARD_VERTICES_PER_POINT; i++ ) {
				this.lineIndices[vertexOffset++] = lineIndex
			}
		}
	}

	async init() {
		await stage3d.initRender( { background: SKY_HORIZON } )
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()
		stage3d.control = new OrbitControl( stage3d.camera, 30 )
		stage3d.scene.fog = new Fog( SKY_HAZE, 38, 92 )

		const loader = new TextureLoader()
		this.texture = loader.load( '/textures/baguette.png' )
		this.texture.colorSpace = SRGBColorSpace
		this.noise = loader.load( '/textures/noises/perlin/rgb-256x256.png' )
		this.noise.wrapS = RepeatWrapping
		this.noise.wrapT = RepeatWrapping
		this.createSky()
		this.createLine()
		this.initHud()
		this.hint = createDemoHint( `${BAGUETTE_COUNT} baguettes · one MeshLine · fake 3D normals & lights (L to toggle Flat)`, { accent: '#f5b453', hideAfter: 9000 } )

		window.addEventListener( 'resize', this.onResize )
		keyboard.onDown.add( this.onKeyDown )
		stage.onUpdate.add( this.update )
	}

	createSky() {
		const sun = vec3( SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z )
		stage3d.scene.backgroundNode = Fn( () => {
			const direction = positionWorldDirection.normalize()
			const elevation = direction.y
			const sky = mix( color( SKY_HORIZON ), color( SKY_ZENITH ), smoothstep( -0.35, 0.6, elevation ) )
			// Slow, soft cumulus on a dome projection, thinning toward the horizon.
			const cloudUV = direction.xz.div( elevation.abs().add( 0.32 ) ).mul( 0.2 ).add( time.mul( 0.003 ) )
			const cloudNoise = texture( this.noise, cloudUV ).r.mul( 0.65 )
				.add( texture( this.noise, cloudUV.mul( 2.7 ) ).g.mul( 0.35 ) )
			const cloud = smoothstep( 0.52, 0.7, cloudNoise ).mul( smoothstep( -0.08, 0.25, elevation ) )
			const clouded = mix( sky, color( 0xFFFFFF ), cloud.mul( 0.9 ) )
			const sunGlow = pow( max( dot( direction, sun ), 0 ), 6 ).mul( 0.35 )
			return vec4( clouded.add( color( 0xFFE2B0 ).mul( sunGlow ) ), 1 )
		} )()
	}

	createLine() {
		this.updatePositions( 0 )

		const sunDir = vec3( SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z )

		// Local slash & crumb relief heightfield from the baguette texture.
		// Note: Three.js flipY=true places the bottom of baguette.png at uv.y=0,
		// so we neutralize the photo's baked bottom shadow first so it doesn't
		// bias the slope or flip shadows when a loaf flies right-to-left.
		const sampleRelief = Fn( ( [uvPoint] ) => {
			const clampedUV = clamp( uvPoint, vec2( 0.002, 0.002 ), vec2( 0.998, 0.998 ) )
			const s = texture( this.texture, clampedUV )
			const unshadow = float( 1 ).add( smoothstep( 0.42, 0.04, clampedUV.y ).mul( 0.38 ) )
			const rgb = s.rgb.mul( unshadow )
			const lum = dot( rgb, vec3( 0.33, 0.47, 0.20 ) )
			const golden = clamp( rgb.r.sub( rgb.b ).mul( 1.9 ), 0, 1 )
			return golden.mul( 0.55 ).add( lum.mul( 0.45 ) )
		} )

		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.dynamic( true )
			.needsProgress( false )
			.lineWidth( 1.4 )
			// Loaves come in slightly different sizes; the width stays constant
			// along each one so the texture keeps its proportions.
			.widthFn( Fn( ( [width] ) => width.mul( hash( attribute( 'lineIndex', 'float' ) ).mul( 0.3 ).add( 0.85 ) ) ) )
			.normalFn( Fn( ( [normal, dir] ) => {
				// `dir` is the exact unit 2D screen-space tangent along +uv.x, and
				// `vec2(-dir.y, dir.x)` is the exact screen direction of `side = +1`.
				vScreenDir.assign( dir )
				return normal
			} ) )
			.map( this.texture )
			.alphaTest( 0.1 )
			.colorFn( Fn( ( [baseColor] ) => {
				// Each loaf gets its own bake, from pale to well done: a warm,
				// believable spread instead of darker copies.
				const bake = hash( attribute( 'lineIndex', 'float' ) ).toVar()
				const crust = mix( vec3( 1.06, 1.03, 0.97 ), vec3( 0.9, 0.78, 0.64 ), bake )

				vWorldPos.assign( positionGeometry )
				vBake.assign( bake )

				return vec4( baseColor.rgb.mul( crust ), float( 1 ) )
			} ) )
			.fragmentColorFn( Fn( ( [flatColor, uvCoords, , side] ) => {
				const isFlat = this.shadingModeUniform.lessThan( 0.5 )
				const isNormals = this.shadingModeUniform.greaterThan( 1.5 )

				// 1. Exact 2D screen/view frame of the line segment:
				// T2 points along the line (+uv.x); B2 points toward the `side = +1` edge (uv.y = 0).
				const T2 = normalize( vScreenDir.add( vec2( 1e-5, 0 ) ) ).toVar()
				const B2 = vec2( T2.y.negate(), T2.x ).toVar()

				// 2. Interior slash (grignes) & crumb relief (aspect-corrected for 668x97).
				const du = float( 0.0032 )
				const dv = float( 0.022 )
				const hCenter = sampleRelief( uvCoords ).toVar()
				const hPlusT = sampleRelief( uvCoords.add( vec2( du, 0 ) ) ).toVar()
				const hMinusT = sampleRelief( uvCoords.sub( vec2( du, 0 ) ) ).toVar()
				// uv.y = 0 is `side = +1` (+B2); uv.y = 1 is `side = -1` (-B2).
				const hPlusB = sampleRelief( uvCoords.sub( vec2( 0, dv ) ) ).toVar()
				const hMinusB = sampleRelief( uvCoords.add( vec2( 0, dv ) ) ).toVar()

				const blisterUV = vec2( uvCoords.x.mul( 5.5 ).add( vBake.mul( 3.7 ) ), uvCoords.y.mul( 0.9 ).add( vBake.mul( 1.9 ) ) )
				const blister = texture( this.noise, blisterUV ).rg.sub( 0.5 )

				// Fade relief near the silhouette so the outer cylinder edge stays smoothly rounded.
				const interiorMask = smoothstep( 0.96, 0.35, side.abs() )
				const bumpT = hMinusT.sub( hPlusT ).mul( interiorMask ).add( blister.x.mul( 0.08 ) )
				const bumpB = hMinusB.sub( hPlusB ).mul( interiorMask ).add( blister.y.mul( 0.08 ) )

				// 3. 3D Cylinder + rounded end-caps in the line's (T2, B2) frame, rotated into View Space:
				// Because B2 is `vec2(-T2.y, T2.x)` and `side` is signed across B2, `B2 * cylB`
				// ALWAYS points outward in true screen/view space regardless of line direction!
				const cylB = clamp( side.mul( 1.12 ), -0.95, 0.95 ).toVar()
				const tipT = smoothstep( 0.86, 0.99, uvCoords.x ).mul( 0.78 )
					.sub( smoothstep( 0.14, 0.01, uvCoords.x ).mul( 0.78 ) ).toVar()
				const nT = tipT.add( bumpT.mul( 0.55 ) ).toVar()
				const nB = cylB.add( bumpB.mul( 0.45 ) ).toVar()
				const nZ = sqrt( max( float( 1 ).sub( cylB.mul( cylB ) ).sub( tipT.mul( tipT ).mul( 0.7 ) ), 0.08 ) ).toVar()

				const nXY = T2.mul( nT ).add( B2.mul( nB ) )
				const viewNormal = normalize( vec3( nXY.x, nXY.y, nZ ) ).toVar()

				// 4. Material masks & equalize the photo's baked bottom shadow at uv.y near 0.
				const texRaw = texture( this.texture, uvCoords ).toVar()
				const bakedShadowLift = smoothstep( 0.44, 0.04, uvCoords.y )
				const albedo = flatColor.rgb.mul( mix( vec3( 1 ), vec3( 1.32, 1.38, 1.48 ), bakedShadowLift ) ).toVar()
				const crustMask = smoothstep( 0.20, 0.40, texRaw.r.sub( texRaw.b.mul( 0.85 ) ) ).toVar()

				const neighborAvg = hPlusT.add( hMinusT ).add( hPlusB ).add( hMinusB ).mul( 0.25 )
				const cavity = neighborAvg.sub( hCenter ).mul( interiorMask )
				const creviceAO = clamp( float( 1 ).sub( cavity.mul( 1.8 ) ), 0.68, 1.08 )
				const earRidge = clamp( cavity.negate().mul( 3.5 ), 0, 1 )

				// 5. Consistent directional sun & sky lighting in View Space:
				// Transform world sun into view space while keeping the sun high above (+Y)
				// and at a grazing forward angle (z = 0.28) so EVERY baguette has its
				// sunlit highlight on the upper/sunward side and its shadow on the underside.
				const sunViewRaw = modelViewMatrix.mul( vec4( sunDir, 0 ) ).xyz
				const keyLight = normalize( vec3( sunViewRaw.x.mul( 0.65 ), max( sunViewRaw.y, 0.68 ), 0.28 ) ).toVar()

				const NdotL = dot( viewNormal, keyLight ).toVar()
				const sunDiffuse = smoothstep( -0.45, 0.75, NdotL ).toVar()

				// Warm bakery subsurface scatter along the light-to-shadow terminator.
				const wrapBand = smoothstep( -0.65, 0.05, NdotL ).mul( float( 1 ).sub( smoothstep( -0.05, 0.55, NdotL ) ) )
				const sssLight = vec3( 1.0, 0.44, 0.08 ).mul( wrapBand ).mul( float( 0.34 ).add( crustMask.mul( 0.20 ) ) )

				// Hemispherical summer sky fill: upper side (+Y) gets bright sky, lower side (-Y) gets cool shadow.
				const skyUp = clamp( viewNormal.y.mul( 0.5 ).add( 0.5 ), 0, 1 )
				const skyShadow = mix( vec3( 0.38, 0.45, 0.64 ), vec3( 0.56, 0.64, 0.80 ), skyUp )
				const sunLitColor = vec3( 1.26, 1.14, 0.95 )

				const directLight = mix( skyShadow, sunLitColor, sunDiffuse ).add( sssLight )
				const litRGB = albedo.mul( directLight ).mul( creviceAO ).toVar()

				// Crispy glazed crust specular + bright highlights on the raised slash ears (grignes).
				const halfVec = normalize( keyLight.add( vec3( 0, 0, 1 ) ) )
				const NdotH = max( dot( viewNormal, halfVec ), 0 )
				const specGate = smoothstep( -0.05, 0.40, NdotL )
				const specBroad = pow( NdotH, 16 ).mul( crustMask ).mul( 0.22 )
				const specCrisp = pow( NdotH, 42 ).mul( crustMask.mul( 0.5 ).add( earRidge.mul( 1.4 ) ) ).mul( 0.28 )
				litRGB.addAssign( vec3( 1.0, 0.90, 0.66 ).mul( specBroad.add( specCrisp ) ).mul( specGate ) )

				// 3D Fresnel rim on the sunlit upper edge + solar backlight when passing in front of the sun.
				const V = normalize( cameraPosition.sub( vWorldPos ) )
				const fresnel = pow( float( 1 ).sub( clamp( viewNormal.z, 0, 1 ) ), 2.6 )
				const sunBacklight = pow( max( dot( V.negate(), sunDir ), 0 ), 3 ).mul( 0.5 )
				const rimStrength = fresnel.mul( smoothstep( 0.0, 0.7, NdotL ).mul( 0.30 ).add( sunBacklight ) )
				litRGB.addAssign( vec3( 1.0, 0.85, 0.54 ).mul( rimStrength ).mul( float( 0.45 ).add( crustMask.mul( 0.55 ) ) ) )

				// Normal-map inspection view shows the true 3D view-space normal (X=right, Y=up, Z=front).
				const normalPreview = viewNormal.mul( 0.5 ).add( 0.5 )
				const shadedColor = select( isNormals, normalPreview, litRGB )

				return vec4( select( isFlat, flatColor.rgb, shadedColor ), flatColor.a )
			} ) )

		this.line.addVertexAttribute( 'lineIndex', 1 )
		this.line.setVertexValues( 'lineIndex', this.lineIndices )

		stage3d.add( this.line )
	}

	initHud() {
		if ( typeof document === 'undefined' || new URLSearchParams( window.location.search ).has( 'noUI' ) ) return
		ensureHudStyle()

		const hud = document.createElement( 'div' )
		hud.className = 'BaguetteShadingHud'
		hud.setAttribute( 'role', 'group' )
		hud.setAttribute( 'aria-label', 'Baguette shading mode' )

		const modes = [
			{ id: 'lit', label: '3D Lit', title: 'Fake 3D cylinder + slash relief normals, sun & sky lighting, crust sheen & SSS (L)' },
			{ id: 'flat', label: 'Flat', title: 'Original unlit flat texture mode (L)' },
			{ id: 'normals', label: 'Normals', title: 'Inspect reconstructed 3D cylinder + grigne relief normals (L)' },
		]

		modes.forEach( ( mode ) => {
			const btn = document.createElement( 'button' )
			btn.type = 'button'
			btn.className = 'BaguetteShadingHud__btn'
			btn.title = mode.title

			const dot = document.createElement( 'span' )
			dot.className = 'BaguetteShadingHud__dot'

			const text = document.createElement( 'span' )
			text.textContent = mode.label

			btn.append( dot, text )
			btn.addEventListener( 'pointerdown', e => e.stopPropagation() )
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation()
				this.setShadingMode( mode.id )
			} )

			hud.appendChild( btn )
			this.hudButtons[mode.id] = btn
		} )

		document.body.appendChild( hud )
		this.hud = hud
		this.updateHud()
	}

	setShadingMode( mode ) {
		if ( !['lit', 'flat', 'normals'].includes( mode ) ) return
		this.shadingMode = mode
		this.shadingModeUniform.value = mode === 'flat' ? 0 : mode === 'normals' ? 2 : 1
		this.updateHud()
	}

	updateHud() {
		for ( const [id, btn] of Object.entries( this.hudButtons ) ) {
			const active = this.shadingMode === id
			btn.classList.toggle( 'is-active', active )
			btn.setAttribute( 'aria-pressed', active ? 'true' : 'false' )
		}
	}

	onKeyDown = ( key ) => {
		if ( key === 'l' || key === 'L' ) {
			const order = ['lit', 'flat', 'normals']
			const next = order[( order.indexOf( this.shadingMode ) + 1 ) % order.length]
			this.setShadingMode( next )
		}
	}

	updatePositions( dt ) {
		const stepDistance = BAGUETTE_LENGTH / ( SEGMENTS - 1 )
		for ( let baguetteIndex = 0; baguetteIndex < BAGUETTE_COUNT; baguetteIndex++ ) {
			const baguette = this.baguettes[baguetteIndex]
			const curve = this.curves[baguetteIndex]
			const curveLength = baguette.curveLength
			const invCurveLength = 1 / curveLength
			baguette.progress += baguette.speed * dt * 0.001
			if ( baguette.progress > 1 ) baguette.progress -= 1
			const startDistance = baguette.progress * curveLength

			for ( let i = 0; i < SEGMENTS; i++ ) {
				let pointDistance = startDistance - i * stepDistance

				if ( pointDistance < 0 ) pointDistance += curveLength
				if ( pointDistance > curveLength ) pointDistance -= curveLength

				const position = curve.getPoint( pointDistance * invCurveLength, this.samplePoint )
				const offset = i * 3

				baguette.positions[offset] = position.x
				baguette.positions[offset + 1] = position.y
				baguette.positions[offset + 2] = position.z
			}
		}
	}

	update = ( dt ) => {
		const delta = Math.min( dt, 100 )
		this.updatePositions( this.reducedMotion ? delta * 0.3 : delta )
		this.line.setPositions( this.lineArrays )
		const control = stage3d.control
		if ( control && !control._isDown && !this.reducedMotion ) control._theta += delta * AUTO_ROTATE_SPEED
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		keyboard.onDown.remove( this.onKeyDown )
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		stage3d.control?.dispose()
		this.line?.dispose()
		this.line = null
		this.hint?.remove()
		this.hint = null
		this.hud?.remove()
		this.hud = null
		this.hudButtons = {}

		stage3d.scene.fog = null
		stage3d.scene.backgroundNode = null

		this.texture?.dispose()
		this.texture = null
		this.noise?.dispose()
		this.noise = null
	}

}

export default FlyingBaguettesExample
