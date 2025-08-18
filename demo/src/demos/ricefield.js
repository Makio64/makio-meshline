import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import { MeshLine, rectanglePositions } from 'meshline'
import { smoothstep } from '@/makio/utils/math'
import { Mesh, MeshBasicMaterial, PlaneGeometry, StaticDrawUsage, Group, Color, Raycaster, Vector2, Vector3, Plane, StorageBufferAttribute, TextureLoader, RepeatWrapping, SRGBColorSpace, MathUtils } from 'three/webgpu'
import { reflector, abs, sin, cos, time, uv, Fn, float, attribute, vec3, uniform, length, clamp, smoothstep as tslSmoothstep, storage, instanceIndex, If, sub, mul, add, vec4, mix, fract, vec2, texture, textureBicubic } from 'three/tsl'
import QuadTree from '@/makio/generative/QuadTree'

import { PMREMGenerator, DynamicDrawUsage, MeshStandardNodeMaterial } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { animate } from 'animejs'
import { mouse, onMove, onClick } from '@/makio/utils/input/mouse'
import { isMobile } from '@/makio/utils/detect'

const FIELD_WIDTH = 64 // Total width of the rice field
const FIELD_HEIGHT = 64 // Total height of the rice field
const spacing = 0.3 // Distance between stalks
const jitter = 0.1
const lineSegments = 3 // number of segments per line
const waterPadding = 8 // Extra padding for water plane
const intersectPoint = new Vector3()

class RicefieldExample {
	constructor() {
		this.lines = null
		this.time = 0
		this.lineArrays = []
		this.quadTreeGroup = null
		this.fieldBorders = []
		this.raycaster = new Raycaster()
		this.mouse = new Vector2()
		this.mouseWorldPos = new Vector3()
		this.groundPlane = new Plane( new Vector3( 0, 1, 0 ), 0 ) // Y-up plane at Y=0
		this.mouseUniform = uniform( vec3( 1000, 0, 1000 ) ) // Initialize far away
		this.cutDistMin = uniform( float( 0 ) ) // Inner radius of shockwave
		this.cutDistMax = uniform( float( 0 ) ) // Outer radius of shockwave
		this.shockwaveOrigin = uniform( vec3( 0, 0, 0 ) ) // Fixed origin for shockwave
		this.mouseSpeedUniform = uniform( float( 1 ) ) // Mouse speed multiplier for interaction radius
		this.areaOfEffectUniform = uniform( float( 1 ) ) // Area of effect multiplier (0-1)
		this.cells = []
		this.riceInstances = []
		this.centerOffsetX = FIELD_WIDTH / 2
		this.centerOffsetZ = FIELD_HEIGHT / 2
		this.water = null
		this.reflectionTarget = null
		this.noiseTexture = null
		this.params = {}
		// Mouse speed tracking
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
		await this.initHDR()
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
		onMove.add( this.onMouseMove )
		onClick.add( this.onMouseClick )
	}

	initScene() {
		// Load shared noise texture first
		const textureLoader = new TextureLoader()
		this.noiseTexture = textureLoader.load( '/textures/noises/perlin/rgb-256x256.png' )
		this.noiseTexture.wrapS = RepeatWrapping
		this.noiseTexture.wrapT = RepeatWrapping
		this.noiseTexture.colorSpace = SRGBColorSpace
		
		this.initQuadtree()
		this.initWater()
		this.initRicefield()
		this.initCompute()
		this.initSky()
	}

	async initHDR() {
		const env = new RoomEnvironment()
		const pmrem = new PMREMGenerator( stage3d.	renderer )
		pmrem.compileCubemapShader()
		const envMap = await pmrem.fromScene( env ).texture
		stage3d.scene.environment = envMap
		env.dispose()
		pmrem.dispose()
	}

	initSky() {
		stage3d.scene.backgroundNode = Fn( () => {
			const skyColor = vec3( 0, 0, 0.05 ) // Light blue sky
			const groundColor = vec3( 0 ) // Greenish ground
			const gradientFactor = uv().y//.add( .5 ).div( 2 ) // Vertical gradient based on screen UV
			return vec4( mix( groundColor, skyColor, gradientFactor ), 1 )
		} )()
	}

	initQuadtree() {
		let quadtree = new QuadTree( FIELD_WIDTH, FIELD_HEIGHT, {
			maxDepth: 8,
			minSize: 1,
			jitter: 0.4,
			minPadding: 1,
			maxPadding: 2,
			randomNext: 0.2,
			total: 14 // Set a total number of cells to generate
		} )

		this.cells = quadtree.compute()
		console.log( 'Quadtree cells:', this.cells.length )
	}

	initWater() {
		// water - size based on quadtree + padding
		const reflection = reflector( { resolution: isMobile ? 0.5 : 1, bounces: false, generateMipmaps: true } ) // 0.5 is half of the rendering view
		this.reflectionTarget = reflection.target
		this.reflectionTarget.rotateX( - Math.PI / 2 )
		stage3d.add( this.reflectionTarget )

		// Animated UV for water ripples
		const animatedUV = uv().mul( 3 ).add( vec2( time.mul( 0.05 ), time.mul( 0.03 ) ) )
		const roughness = texture( this.noiseTexture, animatedUV ).r

		let geo = new PlaneGeometry( FIELD_WIDTH + waterPadding, FIELD_HEIGHT + waterPadding, 1, 1 )
		let material = new MeshStandardNodeMaterial()
		material.transparent = true
		material.metalness = 0.2
		material.roughnessNode = 0.4
		material.colorNode = Fn( () => {
			// Blur reflection based on roughness
			const dirtyReflection = textureBicubic( reflection, roughness )
			
			// Darken and tint the reflection for murky water
			// const waterTint = vec3( 0.05, 0.1, 0.08 ) // Dark greenish-brown
			// const tintedReflection = dirtyReflection.rgb.mul( 0.3 ).add( waterTint )
			
			// Falloff opacity by distance
			// const opacity = rangeFogFactor( 10, 40 ).oneMinus().mul( 0.9 )
			
			return vec4( dirtyReflection.rgb, 1 )
		} )()

		this.water = new Mesh( geo, material )
		this.water.rotation.x = - Math.PI / 2
		stage3d.add( this.water )
	}

	initRicefield() {
		// Create quadtree visualization group
		this.quadTreeGroup = new Group()
		this.quadTreeGroup.position.y = 0.01 // Slightly above the water
		stage3d.add( this.quadTreeGroup )

		// Create colored planes for each cell
		const colors = [
			0x4a9eff, // blue
			0xff6b6b, // red
			0x51cf66, // green
			0xffd43b, // yellow
			0xc084fc, // purple
			0xfb8500, // orange
			0x06ffa5, // cyan
			0xff006e  // pink
		]

		// Calculate total rice stalks needed
		this.riceInstances = []

		this.cells.forEach( ( cell, index ) => {
			// Visualize cells with colored planes
			const geometry = new PlaneGeometry( cell.width * 0.98, cell.height * 0.98 ) // Slightly smaller to show gaps
			const color = colors[index % colors.length]
			const material = new MeshBasicMaterial( { 
				color: color,
				opacity: 0.2,
				transparent: true,
				side: 2 // DoubleSide
			} )
			
			const plane = new Mesh( geometry, material )
			plane.rotation.x = -Math.PI / 2
			plane.position.set( 
				cell.x + cell.width / 2 - this.centerOffsetX,
				0,
				cell.y + cell.height / 2 - this.centerOffsetZ
			)
			
			// this.quadTreeGroup.add( plane )
			
			// Generate rice positions within this cell
			const cellPadding = cell.padding || 0.3 // Use cell's padding or default
			const borderOffset = 0.5 // Same as border offset
			const totalPadding = cellPadding + borderOffset
			
			// Calculate available space for rice
			const availableWidth = cell.width - totalPadding * 2
			const availableHeight = cell.height - totalPadding * 2
			
			// Only generate rice if there's enough space
			if ( availableWidth > spacing && availableHeight > spacing ) {
				const riceCountX = Math.max( 1, Math.floor( availableWidth / spacing ) )
				const riceCountZ = Math.max( 1, Math.floor( availableHeight / spacing ) )
				
				// Center the rice grid within the available space
				const startX = cell.x + totalPadding + ( availableWidth - riceCountX * spacing ) / 2
				const startZ = cell.y + totalPadding + ( availableHeight - riceCountZ * spacing ) / 2
				
				// Per-parcel darkness factor, we keep half of the ricefield with the "basic color" the rest is multiply by 0.2 -> 1.2
				const cellDarkness = Math.random() > .5 ? 0.2 + Math.random() : 1
				
				for ( let x = 0; x < riceCountX; x++ ) {
					for ( let z = 0; z < riceCountZ; z++ ) {
						// Constrain jitter to prevent rice from going outside boundaries
						const maxJitter = Math.min( jitter, spacing * 0.4 ) // Limit jitter to 40% of spacing
						const baseX = startX + x * spacing + spacing / 2 + ( Math.random() - 0.5 ) * maxJitter - this.centerOffsetX
						const baseZ = startZ + z * spacing + spacing / 2 + ( Math.random() - 0.5 ) * maxJitter - this.centerOffsetZ
						const height = 2.5 + Math.random() * 1.5
						
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
		
		console.log( 'Total rice stalks:', this.riceInstances.length )
		
		// Create a single rice stalk template (vertical line)
		const templatePositions = new Float32Array( lineSegments * 3 )
		for ( let i = 0; i < lineSegments; i++ ) {
			const t = i / ( lineSegments - 1 )
			templatePositions[i * 3] = 0      // x
			templatePositions[i * 3 + 1] = t * 3  // y (base height of 3)
			templatePositions[i * 3 + 2] = 0      // z
		}
		
		// Create instanced MeshLine without width variation to reduce attributes
		this.lines = new MeshLine()
			.lines( templatePositions, false )
			.instances( this.riceInstances.length )
			.color( 0x493c1a )
			.gradientColor( 0xbfc53d )
			.lineWidth( 0.08 )
			.widthCallback( ( t ) => ( 1 - smoothstep( 0.4, 1, t ) ) )
			// Add colorFn to apply random color variation
			.colorFn( Fn( ( [color, counters, side] ) => {
				const rand = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) )
				const colorScale = rand.mul( 1.1 ).add( .5 )
				const parcelDarkness = attribute( 'instanceDarkness', 'float' )
				return vec4( color.rgb.mul( colorScale ).mul( parcelDarkness ), color.a )
			} ) )
			.gradientFn( Fn( ( [gradientFactor, side] ) => {
				const rand = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) )
				const colorScale = rand.mul( 1.1 ).add( .5 )
				const parcelDarkness = attribute( 'instanceDarkness', 'float' )
				return vec4( gradientFactor.rgb.mul( colorScale ).mul( parcelDarkness ), gradientFactor.a )
			} ) )
			// Add width function that varies with scale
			.widthFn( Fn( ( [width, counters] ) => {
				// Access storage buffer to get current scale
				const scaleStorage = storage( this.scaleStorageBuffer, 'float', this.riceInstances.length )
				const storageScale = scaleStorage.element( instanceIndex )
				
				// Make width proportional to scale (thinner when growing)
				// Scale from 0.3 (at scale 0.01) to 1.0 (at scale 1.0)
				const widthMultiplier = tslSmoothstep( 0.1, 1.0, storageScale ).mul( 0.7 ).add( 0.3 )
				
				return width.mul( widthMultiplier )
			} ) )
			.positionFn( Fn( ( [position, counters] ) => {
				// Get combined instance attributes: xyz = position, w = scale
				const instanceTr = attribute( 'instanceTransform', 'vec4' )
				
				// Access storage buffer directly
				const scaleStorage = storage( this.scaleStorageBuffer, 'float', this.riceInstances.length )
				const storageScale = scaleStorage.element( instanceIndex )
				
				// Calculate world position
				const worldX = position.x.add( instanceTr.x )
				const worldZ = position.z.add( instanceTr.z )
				
				// Combine instance scale with storage scale
				const finalScale = instanceTr.w.mul( storageScale )
				
				// Apply scale to height
				const scaledY = position.y.mul( finalScale )
				
				// Wind effect
				// Sample wind texture using world position and animated time
				// Create rotating wind pattern by using sin/cos
				const windTime = time.mul( 0.2 ).toVar()
				const windUV = vec2( 
					worldX.div( 64 ).add( sin( windTime ).mul( 0.5 ) ),
					worldZ.div( 64 ).add( cos( windTime.mul( 0.7 ) ).mul( 0.5 ) )
				).toVar()
				const windSample = texture( this.noiseTexture, windUV ).toVar()
				
				// Extract wind direction and strength from texture channels
				const windDirX = windSample.r.toVar() // -1 to 1
				const windDirZ = windSample.g.toVar() // -1 to 1
				const windStrength = sin( time.mul( 0.5 ) ).abs().add( 0.7 ).toVar() // 0.5 to 1.5
				
				// Apply wind displacement based on height (more at top) and scale (small rice less affected)
				const heightFactor = position.y.div( 3 ) // 0 to 1 along height
				// Scale the wind effect by the current scale (finalScale goes from 0.01 to 1.0)
				const scaleInfluence = tslSmoothstep( 0.6, 1, finalScale ) // Smooth transition from no wind to full wind
				const windDisplacement = heightFactor.mul( heightFactor ).mul( windStrength ).mul( scaleInfluence )
								
				// Final position with wind
				const finalX = worldX.add( windDirX.mul( windDisplacement ) )
				const finalZ = worldZ.add( windDirZ.mul( windDisplacement ) )
				const finalY = scaledY
				
				// Return transformed position
				return vec3( finalX, finalY, finalZ )
			} ) )
			.usage( DynamicDrawUsage ) // Use dynamic usage for instancing
		
		// Add instance attributes for transform (xyz position + w scale) and parcel darkness
		this.lines.addInstanceAttribute( 'instanceTransform', 4 )
		this.lines.addInstanceAttribute( 'instanceDarkness', 1 )
		
		// Set instance data
		this.riceInstances.forEach( ( instance, i ) => {
			const transform = [instance.position[0], instance.position[1], instance.position[2], instance.scale]
			this.lines.setInstanceValue( 'instanceTransform', i, transform )
			this.lines.setInstanceValue( 'instanceDarkness', i, instance.darkness )
		} )

		stage3d.add( this.lines )
		
		// Create field borders around each quadtree cell - batch into single MeshLine
		const allBorderPositions = []
		const borderLoops = []
		
		// Add water border as first segment
		const borderWidth = FIELD_WIDTH + waterPadding
		const borderHeight = FIELD_HEIGHT + waterPadding
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
			console.log( 'Total border segments:', allBorderPositions.length )
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
		// Create storage buffer for dynamic scale only (not as attribute)
		this.scaleStorageBuffer = new StorageBufferAttribute( this.riceInstances.length, 1 )
		
		// Initialize storage buffer scales
		for ( let i = 0; i < this.riceInstances.length; i++ ) {
			this.scaleStorageBuffer.setX( i, 1.0 ) // Start at full scale
		}
		this.scaleStorageBuffer.needsUpdate = true
		
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
		const scaleAttribute = storage( this.scaleStorageBuffer, 'float', count )
		const positionAttribute = storage( positionBuffer, 'vec3', count )
		
		const currentScale = scaleAttribute.element( instanceIndex )
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
		intersectPoint.set( 0, 0, 0 )
		this.raycaster.ray.intersectPlane( this.groundPlane, intersectPoint )
		if ( intersectPoint && !( intersectPoint.x == 0 && intersectPoint.z == 0 && intersectPoint.y == 0 ) ) {
			// Update the uniform with the world position
			this.mouseUniform.value.set( intersectPoint.x, 0, intersectPoint.z )
		}
	}
	
	onMouseClick = ( mouseData ) => {
		// Convert mouse position to normalized device coordinates
		const clickMouse = new Vector2( mouseData.normalizedX, -mouseData.normalizedY )
		
		// Update raycaster with camera and mouse position
		this.raycaster.setFromCamera( clickMouse, stage3d.camera )
		
		// Calculate intersection with ground plane
		const clickPoint = new Vector3()
		this.raycaster.ray.intersectPlane( this.groundPlane, clickPoint )
		
		if ( clickPoint && !( clickPoint.x == 0 && clickPoint.z == 0 && clickPoint.y == 0 ) ) {
			// Trigger shockwave animation
			this.createShockwave( clickPoint )
		}
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
		// Remove event listeners
		window.removeEventListener( 'resize', this.onResize )
		onMove.remove( this.onMouseMove )
		onClick.remove( this.onMouseClick )
		
		// Dispose rice lines
		if ( this.lines ) {
			stage3d.remove( this.lines )
			this.lines.dispose()
			this.lines = null
		}
		
		// Dispose field border
		if ( this.fieldBorder ) {
			stage3d.remove( this.fieldBorder )
			this.fieldBorder.dispose()
			this.fieldBorder = null
		}
		
		// Dispose water
		if ( this.water ) {
			stage3d.remove( this.water )
			this.water.geometry.dispose()
			this.water.material.dispose()
			this.water = null
		}
		
		// Dispose reflection target
		if ( this.reflectionTarget ) {
			stage3d.remove( this.reflectionTarget )
			// Note: the reflector target disposal is handled by Three.js internally
			this.reflectionTarget = null
		}
		
		// Dispose quadtree visualization group
		if ( this.quadTreeGroup ) {
			stage3d.remove( this.quadTreeGroup )
			this.quadTreeGroup.traverse( ( child ) => {
				if ( child.geometry ) child.geometry.dispose()
				if ( child.material ) child.material.dispose()
			} )
			this.quadTreeGroup = null
		}
		
		// Clear compute shader resources
		if ( this.scaleStorageBuffer ) {
			// StorageBufferAttribute doesn't need explicit disposal
			this.scaleStorageBuffer = null
		}
		
		// Dispose compute update
		if ( this.computeUpdate ) {
			this.computeUpdate = null
		}
		
		// Clear data arrays
		this.cells = []
		this.riceInstances = []
		this.lineArrays = []
		
		// Dispose controls
		if ( stage3d.control ) {
			stage3d.control.dispose()
		}
		
		// Clear background node
		if ( stage3d.scene.backgroundNode ) {
			stage3d.scene.backgroundNode = null
		}
		
		// Dispose noise texture
		if ( this.noiseTexture ) {
			this.noiseTexture.dispose()
			this.noiseTexture = null
		}
		
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
		let isMouseMoving = distance > 1 // Threshold to detect if mouse is moving

		if ( isMouseMoving ) {
			this.areaOfEffectUniform.value += ( 1 - this.areaOfEffectUniform.value ) * 0.15
		} else {
			// Mouse stopped - decrease by 0.95 per frame
			this.areaOfEffectUniform.value *= 0.95
		}
	}
	
}

export default new RicefieldExample() 