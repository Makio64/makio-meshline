import { animate } from 'animejs'
import { MeshLine, rectanglePositions } from 'makio-meshline'
import { add, cameraPosition, clamp, color, cos, dot, float, Fn, fract, If, instanceIndex, length, max, mix, mul, normalize, positionWorld, positionWorldDirection, pow, reflector, sin, smoothstep as tslSmoothstep, storage, sub, texture, time, uniform, uv, vec2, vec3, vec4, viewportSize } from 'three/tsl'
import {
	MathUtils,
	Mesh,
	MeshBasicNodeMaterial,
	Plane,
	PlaneGeometry,
	Raycaster,
	RepeatWrapping,
	StaticDrawUsage,
	StorageBufferAttribute,
	TextureLoader,
	Vector2,
	Vector3,
} from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import QuadTree from '@/makio/generative/QuadTree'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import { mouse, onClick, onMove } from '@/makio/utils/input/mouse'
import { smoothstep } from '@/makio/utils/math'
import random from '@/makio/utils/random'

const FIELD_WIDTH = 64
const FIELD_HEIGHT = 64
const STALK_SPACING = 0.3
const STALK_JITTER = 0.1
const STALK_SEGMENTS = 3
const WATER_PADDING = 8
const WATER_HEIGHT = -0.02
const REFLECTION_DESKTOP_DENSITY = 1.25
const REFLECTION_DESKTOP_SCALE = 1
const REFLECTION_MOBILE_DENSITY = 0.75
const REFLECTION_MOBILE_SCALE = 0.5
const WATER_BASE_REFLECTIVITY = 0.08
const WATER_DISTORTION = 0.002
const _intersectPoint = new Vector3()

class RicefieldExample {
	constructor() {
		this.lines = null
		this.raycaster = new Raycaster()
		this.mouse = new Vector2()
		this.groundPlane = new Plane( new Vector3( 0, 1, 0 ), 0 ) // Y-up plane at Y=0
		this.mouseUniform = uniform( new Vector3( 1000, 0, 1000 ) ) // Initialize far away
		this.cutDistMin = uniform( 0 ) // Inner radius of shockwave
		this.cutDistMax = uniform( 0 ) // Outer radius of shockwave
		this.shockwaveOrigin = uniform( new Vector3( 0, 0, 0 ) ) // Fixed origin for shockwave
		this.mouseSpeedUniform = uniform( 1 ) // Mouse speed multiplier for interaction radius
		this.areaOfEffectUniform = uniform( 1 ) // Area of effect multiplier (0-1)
		this.cells = []
		this.riceInstances = []
		this.centerOffsetX = FIELD_WIDTH / 2
		this.centerOffsetZ = FIELD_HEIGHT / 2
		this.water = null
		this.reflection = null
		this.reflectionTarget = null
		this.noiseTexture = null
		this.mouseSpeed = 0
		this.targetMouseSpeed = 0
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 60 )
		stage3d.control._phi = 0.9
		stage3d.control._theta = 0.5
		stage3d.control.maxRadius = 100
		stage3d.control.minRadius = 20
		stage3d.control.minPhi = 0.1
		stage3d.control.maxPhi = Math.PI * 0.45
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()
		this.initScene()
		stage.onResize.add( this.onResize )
		onMove.add( this.onMouseMove )
		onClick.add( this.onMouseClick )
	}

	initScene() {
		// Load shared noise texture first
		const textureLoader = new TextureLoader()
		this.noiseTexture = textureLoader.load( '/textures/noises/perlin/rgb-256x256.png' )
		this.noiseTexture.wrapS = RepeatWrapping
		this.noiseTexture.wrapT = RepeatWrapping
		
		this.initQuadtree()
		this.initWater()
		this.initRicefield()
		this.initCompute()
		this.initSky()
	}

	initSky() {
		stage3d.scene.backgroundNode = Fn( () => {
			const skyColor = vec3( 0, 0, 0.05 )
			const groundColor = vec3( 0 )
			const gradientFactor = positionWorldDirection.y.mul( 0.5 ).add( 0.5 )
			return vec4( mix( groundColor, skyColor, gradientFactor ), 1 )
		} )()
	}

	initQuadtree() {
		const quadtree = new QuadTree( FIELD_WIDTH, FIELD_HEIGHT, {
			maxDepth: 8,
			minSize: 1,
			jitter: 0.4,
			minPadding: 1,
			maxPadding: 2,
			randomNext: 0.2,
			total: 14 // Set a total number of cells to generate
		} )

		this.cells = quadtree.compute()
	}

	initWater() {
		// Keep the reflection at or below CSS-pixel resolution. This avoids the
		// quadratic render-target cost of mirroring the full high-DPI backbuffer.
		const maxResolutionScale = isMobile ? REFLECTION_MOBILE_SCALE : REFLECTION_DESKTOP_SCALE
		const pixelDensity = isMobile ? REFLECTION_MOBILE_DENSITY : REFLECTION_DESKTOP_DENSITY
		const resolutionScale = Math.min( maxResolutionScale, pixelDensity / stage.devicePixelRatio )
		const reflection = reflector( {
			resolutionScale,
			bounces: false,
			generateMipmaps: false,
			samples: 0,
		} )
		this.reflection = reflection
		this.reflectionTarget = reflection.target

		const geo = new PlaneGeometry( FIELD_WIDTH + WATER_PADDING, FIELD_HEIGHT + WATER_PADDING, 1, 1 )
		const material = new MeshBasicNodeMaterial()

		// Adapt the dual-flow normal treatment from Three.js' WebGPU water example.
		// Sampling the shared noise map in two coordinate frames avoids a visibly
		// repeating scroll without adding another texture to memory.
		const waterUV = uv()
		const flowTime = time.mul( 0.025 )
		const waveUV0 = waterUV.mul( vec2( 5, 7 ) ).add( vec2( flowTime, flowTime.mul( 0.7 ) ) )
		const waveUV1 = vec2( waterUV.y, waterUV.x.negate() )
			.mul( vec2( 8, 5 ) )
			.add( vec2( flowTime.mul( -0.55 ), flowTime.mul( 0.9 ) ) )
		const wave0 = texture( this.noiseTexture, waveUV0 ).rg.mul( 2 ).sub( 1 )
		const wave1 = texture( this.noiseTexture, waveUV1 ).gb.mul( 2 ).sub( 1 )
		const waterWave = wave0.add( wave1.mul( 0.6 ) ).mul( 0.625 ).toVar( 'waterWave' )

		material.colorNode = Fn( () => {
			const surfaceNormal = normalize( vec3( waterWave.x.mul( 0.14 ), 1, waterWave.y.mul( 0.14 ) ) )
			const toEye = normalize( cameraPosition.sub( positionWorld ) )
			const theta = max( dot( toEye, surfaceNormal ), 0 )
			const fresnel = pow( float( 1 ).sub( theta ), 5 )
				.mul( 1 - WATER_BASE_REFLECTIVITY )
				.add( WATER_BASE_REFLECTIVITY )

			// Resolve across adjacent reflector texels. This hides the CSS-resolution
			// pixel grid while keeping the reflection sharper and cheaper than the old
			// eight-fetch bicubic path.
			const reflectionUV = reflection.uvNode.add( waterWave.mul( WATER_DISTORTION ) )
			let softenedReflection
			if ( isMobile ) {
				softenedReflection = reflection.sample( reflectionUV ).rgb
			} else {
				const reflectionTexel = vec2( 1 ).div( viewportSize.mul( resolutionScale ) )
				const softRadius = float( 0.75 ).add( float( 1 ).sub( theta ).mul( 0.75 ) )
				const softOffsetX = reflectionTexel.x.mul( 0.85 ).mul( softRadius )
				const softOffsetY = reflectionTexel.y.mul( 0.55 ).mul( softRadius )
				const reflectionA = reflection.sample( reflectionUV.add( vec2( softOffsetX, softOffsetY ) ) ).rgb
				const reflectionB = reflection.sample( reflectionUV.add( vec2( softOffsetX, softOffsetY.negate() ) ) ).rgb
				const reflectionC = reflection.sample( reflectionUV.add( vec2( softOffsetX.negate(), softOffsetY ) ) ).rgb
				const reflectionD = reflection.sample( reflectionUV.sub( vec2( softOffsetX, softOffsetY ) ) ).rgb
				softenedReflection = reflectionA.add( reflectionB ).add( reflectionC ).add( reflectionD ).mul( 0.25 )
			}
			const facingTint = clamp( theta.mul( 0.8 ), 0, 1 )
			const waterTint = mix(
				vec3( 0.035, 0.055, 0.09 ),
				vec3( 0.095, 0.13, 0.155 ),
				facingTint
			)
			const reflectedWater = softenedReflection.mul( vec3( 0.82, 0.92, 1 ) )
			const reflectionWeight = fresnel.mul( 0.68 ).add( 0.28 )

			return vec4( mix( waterTint, reflectedWater, reflectionWeight ), 1 )
		} )()

		this.water = new Mesh( geo, material )
		this.water.rotation.x = - Math.PI / 2
		this.water.position.y = WATER_HEIGHT
		this.water.add( this.reflectionTarget )
		stage3d.add( this.water )
	}

	initRicefield() {
		// Calculate total rice stalks needed
		this.riceInstances = []

		this.cells.forEach( ( cell ) => {
			// Generate rice positions within this cell
			const cellPadding = cell.padding || 0.3 // Use cell's padding or default
			const borderOffset = 0.5 // Same as border offset
			const totalPadding = cellPadding + borderOffset
			
			// Calculate available space for rice
			const availableWidth = cell.width - totalPadding * 2
			const availableHeight = cell.height - totalPadding * 2
			
			// Only generate rice if there's enough space
			if ( availableWidth > STALK_SPACING && availableHeight > STALK_SPACING ) {
				const riceCountX = Math.max( 1, Math.floor( availableWidth / STALK_SPACING ) )
				const riceCountZ = Math.max( 1, Math.floor( availableHeight / STALK_SPACING ) )
				
				// Center the rice grid within the available space
				const startX = cell.x + totalPadding + ( availableWidth - riceCountX * STALK_SPACING ) / 2
				const startZ = cell.y + totalPadding + ( availableHeight - riceCountZ * STALK_SPACING ) / 2
				
				// Per-parcel darkness : We keep ~half of the ricefield with the "basic color" the rest is multiply by 0.4 -> 1.2
				const cellDarkness = random() > 0.5 ? random( 0.4, 1.2 ) : 1
				
				for ( let x = 0; x < riceCountX; x++ ) {
					for ( let z = 0; z < riceCountZ; z++ ) {
						// Constrain jitter to prevent rice from going outside boundaries
						const maxJitter = Math.min( STALK_JITTER, STALK_SPACING * 0.4 )
						const baseX = startX + x * STALK_SPACING + STALK_SPACING / 2 + random( -0.5, 0.5 ) * maxJitter - this.centerOffsetX
						const baseZ = startZ + z * STALK_SPACING + STALK_SPACING / 2 + random( -0.5, 0.5 ) * maxJitter - this.centerOffsetZ
						const height = random( 2.5, 4 )
						
						// Store instance data: position and scale
						this.riceInstances.push( {
							position: [baseX, 0, baseZ],
							scale: height / 3, // Normalize to base height of 3
							darkness: cellDarkness
						} )
					}
				}
			}
		} )
		
		// Create storage buffer BEFORE MeshLine (moved from initCompute)
		// Three.js r181+ requires storage buffers to exist when shader hooks reference them
		this.scaleStorageBuffer = new StorageBufferAttribute( this.riceInstances.length, 2 )
		this.transformStorageBuffer = new StorageBufferAttribute( this.riceInstances.length, 4 )
		for ( let i = 0; i < this.riceInstances.length; i++ ) {
			const instance = this.riceInstances[i]
			this.scaleStorageBuffer.setXY( i, 1, instance.darkness )
			this.transformStorageBuffer.setXYZW(
				i,
				instance.position[0],
				instance.position[1],
				instance.position[2],
				instance.scale
			)
		}
		this.scaleStorageBuffer.needsUpdate = true
		this.transformStorageBuffer.needsUpdate = true

		// Create a single rice stalk template (vertical line)
		const templatePositions = new Float32Array( STALK_SEGMENTS * 3 )
		for ( let i = 0; i < STALK_SEGMENTS; i++ ) {
			const t = i / ( STALK_SEGMENTS - 1 )
			templatePositions[i * 3] = 0      // x
			templatePositions[i * 3 + 1] = t * 3  // y (base height of 3)
			templatePositions[i * 3 + 2] = 0      // z
		}

		// These values are invariant for the current/previous/next samples that
		// MeshLine evaluates for each vertex. Share them so wind and storage reads
		// are emitted once instead of three times in the vertex shader.
		const transformStorage = storage( this.transformStorageBuffer, 'vec4', this.riceInstances.length )
		const instanceTransform = transformStorage.element( instanceIndex ).toVar( 'riceInstanceTransform' )
		const instanceStateStorage = storage( this.scaleStorageBuffer, 'vec2', this.riceInstances.length )
		const instanceState = instanceStateStorage.element( instanceIndex ).toVar( 'riceInstanceState' )
		const storageScale = instanceState.x
		const parcelDarkness = instanceState.y
		const finalScale = instanceTransform.w.mul( storageScale ).toVar( 'riceFinalScale' )
		const colorVariation = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) )
			.toVar( 'riceColorVariation' )
		// Static low-frequency noise creates broad, coherent green patches. Unlike
		// the wind sample below, this UV never moves, so each parcel keeps its tint.
		const fieldTintUV = vec2(
			instanceTransform.x.div( FIELD_WIDTH ).mul( 2.15 ).add( 0.37 ),
			instanceTransform.z.div( FIELD_HEIGHT ).mul( 1.75 ).add( 0.19 )
		).toVar( 'riceFieldTintUV' )
		const fieldTintSample = texture( this.noiseTexture, fieldTintUV ).rgb.toVar( 'riceFieldTintSample' )
		const fieldTint = tslSmoothstep(
			0.32,
			0.68,
			fieldTintSample.r.mul( 0.75 ).add( fieldTintSample.g.mul( 0.25 ) )
		).toVar( 'riceFieldTint' )
		const windTime = time.mul( 0.2 ).toVar( 'riceWindTime' )
		const windUV = vec2(
			instanceTransform.x.div( FIELD_WIDTH ).add( sin( windTime ).mul( 0.5 ) ),
			instanceTransform.z.div( FIELD_HEIGHT ).add( cos( windTime.mul( 0.7 ) ).mul( 0.5 ) )
		).toVar( 'riceWindUV' )
		const windSample = texture( this.noiseTexture, windUV ).rg.toVar( 'riceWindSample' )
		const windDirection = windSample.mul( windSample ).toVar( 'riceWindDirection' )
		const windStrength = sin( time.mul( 0.5 ) ).abs().add( 0.7 ).toVar( 'riceWindStrength' )
		const widthMultiplier = tslSmoothstep( 0.1, 1, storageScale ).mul( 0.7 ).add( 0.3 )
		
		// Create instanced MeshLine without width variation to reduce attributes
		this.lines = new MeshLine()
			.lines( templatePositions, false )
			.instances( this.riceInstances.length )
			.color( 0x29330c )
			.lineWidth( 0.1 )
			.widthCallback( ( t ) => ( 1 - smoothstep( 0.4, 1, t ) ) )
			.colorFn( Fn( ( [lineColor, progress, side] ) => {
				// Blend a cooler and a warmer green palette with the coherent field
				// noise, then retain only a trace of individual-stalk variation.
				const rootColor = mix( color( 0x143121 ), color( 0x303d0f ), fieldTint )
				const bodyColor = mix( color( 0x2b653f ), color( 0x6d8424 ), fieldTint )
				const tipColor = mix( color( 0x659955 ), color( 0x9eaa42 ), fieldTint )
				const bladeBody = mix( rootColor, bodyColor, tslSmoothstep( 0, 0.58, progress ) )
				const bladeColor = mix( bladeBody, tipColor, tslSmoothstep( 0.5, 1, progress ) )
				const sideShade = side.mul( 0.075 ).add( 0.925 )
				const parcelShade = parcelDarkness.mul( 0.18 ).add( 0.82 )
				const noiseShade = fieldTintSample.b.mul( 0.12 ).add( 0.9 )
				const stalkShade = colorVariation.mul( 0.06 ).add( 0.97 )

				return vec4(
					bladeColor.mul( sideShade ).mul( parcelShade ).mul( noiseShade ).mul( stalkShade ),
					lineColor.a
				)
			} ) )
			// Add width function that varies with scale
			.widthFn( Fn( ( [width] ) => {
				return width.mul( widthMultiplier )
			} ) )
			.positionFn( Fn( ( [position] ) => {
				// Apply scale to height
				const scaledY = position.y.mul( finalScale )
				
				// Apply wind displacement based on height (more at top) and scale (small rice less affected)
				const heightFactor = position.y.div( 3 ) // 0 to 1 along height
				// Scale the wind effect by the current scale (finalScale goes from 0.01 to 1.0)
				const scaleInfluence = tslSmoothstep( 0.6, 1, finalScale ) // Smooth transition from no wind to full wind
				const windDisplacement = heightFactor.mul( heightFactor ).mul( windStrength ).mul( scaleInfluence )
								
				// Final position with wind
				const finalX = instanceTransform.x.add( windDirection.x.mul( windDisplacement ) )
				const finalZ = instanceTransform.z.add( windDirection.y.mul( windDisplacement ) )
				const finalY = scaledY
				
				// Return transformed position
				return vec3( finalX, finalY, finalZ )
			} ) )
		
		stage3d.add( this.lines )
		
		// Create field borders around each quadtree cell - batch into single MeshLine
		const allBorderPositions = []
		const borderLoops = []
		
		// Add water border as first segment
		const borderWidth = FIELD_WIDTH + WATER_PADDING
		const borderHeight = FIELD_HEIGHT + WATER_PADDING
		const waterBorderPositions = rectanglePositions( borderWidth, borderHeight, 8 )
		
		// Convert to XZ plane and create Float32Array
		const waterBorderFloat32 = new Float32Array( waterBorderPositions.length )
		for ( let i = 0; i < waterBorderPositions.length; i += 3 ) {
			waterBorderFloat32[i] = waterBorderPositions[i]
			waterBorderFloat32[i + 1] = 0.01  // Slightly above water
			waterBorderFloat32[i + 2] = waterBorderPositions[i + 1]  // original y becomes z
		}
		allBorderPositions.push( waterBorderFloat32 )
		borderLoops.push( true )
		
		// Add field borders
		this.cells.forEach( ( cell ) => {
			// Calculate border size: cell size minus padding on both sides, minus 0.5 units from rice
			const cellPadding = cell.padding || 0.3
			const borderOffset = 0.5 // Distance from rice stalks to border
			const actualBorderWidth = cell.width - ( cellPadding + borderOffset ) * 2
			const actualBorderHeight = cell.height - ( cellPadding + borderOffset ) * 2
			
			// Only create border if it's large enough
			if ( actualBorderWidth > 0 && actualBorderHeight > 0 ) {
				// Create positions in XY plane (rectanglePositions returns x,y,0)
				const positions = rectanglePositions( actualBorderWidth, actualBorderHeight, 4 )
				
				// Convert to XZ plane and apply cell offset
				const cellOffsetX = cell.x + cell.width / 2 - this.centerOffsetX
				const cellOffsetZ = cell.y + cell.height / 2 - this.centerOffsetZ
				
				// Create Float32Array for this border
				const borderPositions = new Float32Array( positions.length )
				
				for ( let i = 0; i < positions.length; i += 3 ) {
					borderPositions[i] = positions[i] + cellOffsetX
					borderPositions[i + 1] = 0.02
					borderPositions[i + 2] = positions[i + 1] + cellOffsetZ // original y becomes z
				}
				
				allBorderPositions.push( borderPositions )
				borderLoops.push( true )
			}
		} )
		
		// Create single MeshLine with all borders
		if ( allBorderPositions.length > 0 ) {
			this.fieldBorder = new MeshLine()
				.lines( allBorderPositions, borderLoops )
				.color( 0x8b7355 ) // Brown color for field borders
				.lineWidth( 0.15 )
				.join( { type: 'miter', limit: 8 } )
				.usage( StaticDrawUsage )
			
			stage3d.add( this.fieldBorder )
		}
	}
	
	initCompute() {
		// Storage buffer already created in initRicefield() before MeshLine hooks
		// Create compute shader for scale animation
		this.createComputeShader()
	}
	
	createComputeShader() {
		const count = this.riceInstances.length
		
		// Create position storage buffer for compute shader
		const positionBuffer = new StorageBufferAttribute( count, 3 )
		this.riceInstances.forEach( ( instance, i ) => {
			positionBuffer.setXYZ( i, instance.position[0], instance.position[1], instance.position[2] )
		} )
		
		// Storage attributes
		const scaleAttribute = storage( this.scaleStorageBuffer, 'vec2', count )
		const positionAttribute = storage( positionBuffer, 'vec3', count )
		
		const currentScale = scaleAttribute.element( instanceIndex ).x
		const instancePos = positionAttribute.element( instanceIndex )
		
		// Create compute update function
		this.computeUpdate = Fn( () => {
			// Calculate distance to mouse for normal interaction
			const mousePos = this.mouseUniform
			const worldPos = vec3( instancePos.x, float( 0 ), instancePos.z )
			const mouseDist = length( sub( worldPos, mousePos ) )
			
			// Calculate distance to shockwave origin for shockwave effect
			const shockwaveOrigin = this.shockwaveOrigin
			const shockwaveDist = length( sub( worldPos, shockwaveOrigin ) )
			
			// Check if within shockwave ring (using fixed shockwave origin)
			const withinShockwave = shockwaveDist.greaterThanEqual( this.cutDistMin ).and( shockwaveDist.lessThanEqual( this.cutDistMax ) )
			
			// If within shockwave, instantly cut the rice
			If( withinShockwave, () => {
				currentScale.assign( 0.01 )
			} ).Else( () => {
				// Normal mouse interaction - Target scale based on distance (3m to 7m falloff)
				// Apply mouse speed multiplier to adjust the interaction radius
				// Also apply area of effect uniform to scale the interaction area
				const adjustedMinDist = float( 1 ).mul( this.mouseSpeedUniform ).mul( this.areaOfEffectUniform )
				const adjustedMaxDist = float( 5 ).mul( this.mouseSpeedUniform ).mul( this.areaOfEffectUniform )
				const targetScale = add( mul( tslSmoothstep( adjustedMinDist, adjustedMaxDist, mouseDist ), 0.99 ), 0.01 )
				
				// Check if we're shrinking (target < current) or growing (target > current)
				If( targetScale.lessThan( currentScale ), () => {
					// Instant shrinking when mouse is near
					currentScale.assign( targetScale )
				} ).Else( () => {
					// Slow growth when mouse moves away
					const growthSpeed = float( 0.1 ) // Fixed growth speed
					const frameTime = float( 0.016 ) // Assuming 60fps, ~16ms per frame
					const diff = sub( targetScale, currentScale )
					
					// Check if we're below 50% for linear growth, or above for bounce easing
					If( currentScale.lessThan( 0.5 ), () => {
						currentScale.addAssign( mul( mul( diff, growthSpeed ), frameTime ) )
					} ).Else( () => {
						currentScale.addAssign( targetScale.sub( currentScale ).mul( 0.05 ) )
					} )
				} )
			} )
			
			// Clamp to valid range
			currentScale.assign( clamp( currentScale, 0.01, 1.0 ) )
			
		} )().compute( count )
	}

	onResize = () => {
		this.lines?.resize()
		this.fieldBorder?.resize()
	}
	
	onMouseMove = ( mouseData ) => {
		// Convert mouse position to normalized device coordinates
		this.mouse.x = mouseData.normalizedX
		this.mouse.y = -mouseData.normalizedY
		
		// Update raycaster with camera and mouse position
		this.raycaster.setFromCamera( this.mouse, stage3d.camera )
		
		// Calculate intersection with ground plane
		const intersection = this.raycaster.ray.intersectPlane( this.groundPlane, _intersectPoint )
		if ( intersection ) this.mouseUniform.value.copy( intersection )
	}
	
	onMouseClick = ( mouseData ) => {
		// Convert mouse position to normalized device coordinates
		const clickMouse = new Vector2( mouseData.normalizedX, -mouseData.normalizedY )
		
		// Update raycaster with camera and mouse position
		this.raycaster.setFromCamera( clickMouse, stage3d.camera )
		
		// Calculate intersection with ground plane
		const clickPoint = new Vector3()
		const intersection = this.raycaster.ray.intersectPlane( this.groundPlane, clickPoint )
		if ( intersection ) this.createShockwave( intersection )
	}
	
	createShockwave( clickPoint ) {
		// Reset the shockwave radii
		this.cutDistMin.value = 0
		this.cutDistMax.value = 0
		
		this.shockwaveOrigin.value.set( clickPoint.x, 0, clickPoint.z )
		
		animate( {
			min: 1,
			max: 6
		}, {
			min: 70, // Final inner radius
			max: 95, // Final outer radius
			duration: 1.1,
			ease: 'inOutQuad',
			onUpdate: ( anim ) => {
				const targets = anim.targets[0]
				this.cutDistMin.value = targets.min
				this.cutDistMax.value = targets.max
			},
			onComplete: () => {
				this.cutDistMin.value = 0
				this.cutDistMax.value = 0

			}
		} )
	}

	dispose() {
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.updateCompute )
		stage.onUpdate.remove( this.updateMouseSpeed )
		onMove.remove( this.onMouseMove )
		onClick.remove( this.onMouseClick )

		const disposeObj = ( o ) => {
			if ( !o ) return null
			stage3d.remove( o )
			// Prefer the object's own dispose() when defined — MeshLine cleans up
			// auto-resize listeners and instance buffers internally.
			if ( typeof o.dispose === 'function' ) o.dispose()
			else {
				o.geometry?.dispose()
				o.material?.dispose()
			}
			return null
		}
		for ( const k of ['lines', 'fieldBorder', 'water'] ) {
			this[k] = disposeObj( this[k] )
		}

		this.reflectionTarget?.removeFromParent()
		this.reflectionTarget = null
		this.reflection?.dispose()
		this.reflection = null
		this.noiseTexture?.dispose()
		this.noiseTexture = null
		this.computeUpdate?.dispose()
		this.scaleStorageBuffer = null
		this.transformStorageBuffer = null
		this.computeUpdate = null
		this.cells = []
		this.riceInstances = []
		stage3d.control?.dispose()
		stage3d.scene.backgroundNode = null
	}

	show() {
		// Start the compute shader updates
		if ( this.computeUpdate ) {
			stage.onUpdate.add( this.updateCompute )
		}
		// Add mouse speed tracking
		stage.onUpdate.add( this.updateMouseSpeed )
	}
	
	hide( cb ) { 
		// Stop compute shader updates
		stage.onUpdate.remove( this.updateCompute )
		stage.onUpdate.remove( this.updateMouseSpeed )
		if ( cb ) cb() 
	}
	
	updateCompute = () => {
		// Run the compute shader each frame
		if ( this.computeUpdate && stage3d.renderer ) {
			stage3d.renderer.compute( this.computeUpdate )
		}
	}
	
	updateMouseSpeed = ( dt ) => {
		const distance = Math.sqrt( mouse.moveX * mouse.moveX + mouse.moveY * mouse.moveY )
		this.targetMouseSpeed = distance / ( dt / 16 || 1 )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, this.targetMouseSpeed, 0.15 )
		this.mouseSpeedUniform.value = MathUtils.clamp( 1 + this.mouseSpeed * 0.1, 1, 3 )
		
		// Update area of effect based on mouse movement
		const isMouseMoving = distance > 1 // Threshold to detect if mouse is moving

		if ( isMouseMoving ) {
			this.areaOfEffectUniform.value += ( 1 - this.areaOfEffectUniform.value ) * 0.15
		} else {
			// Mouse stopped - decrease by 0.95 per frame
			this.areaOfEffectUniform.value *= 0.95
		}
	}
	
}

export default RicefieldExample
