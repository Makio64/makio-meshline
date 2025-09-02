<template>
  <div
    ref="canvasContainer"
    class="trail-bg-container"
  />
</template>

<script setup>
import { AdditiveBlending } from 'three/webgpu'
import { onMounted, onUnmounted, ref } from 'vue'

const canvasContainer = ref( null )
let animationId = null
let renderer = null
let scene = null
let camera = null
let lines = []
let meshline = null
let mouse = { x: 0, y: 0, moveX: 0, moveY: 0 }
let targetMouse = { x: 0, y: 0 }
let orbitTarget = null // Store link being hovered
let orbitTime = 0 // Time counter for orbit animation

const NUM_POINTS = 30
const NUM_LINES = 3

// Store cleanup functions
let cleanupFunctions = []

// Register cleanup before any async operations
onUnmounted( () => {
	cleanupFunctions.forEach( fn => fn() )
} )

onMounted( async () => {
	// Only run on desktop
	if ( window.innerWidth < 768 ) return
	
	try {
		// Dynamically import Three.js and MeshLine
		const THREE = await import( 'three/webgpu' )
		const { MeshLine } = await import( 'makio-meshline' )
		
		// Setup renderer with WebGL2
		renderer = new THREE.WebGPURenderer( { 
			antialias: true, 
			alpha: true,
			powerPreference: 'high-performance'
		} )
		renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
		renderer.setSize( window.innerWidth, window.innerHeight )
		renderer.setClearColor( 0x000000, 0 )
		await renderer.init()
		canvasContainer.value.appendChild( renderer.domElement )
		
		// Setup scene and camera
		scene = new THREE.Scene()
		camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.1, 100 )
		camera.position.z = 5
		await renderer.renderAsync(scene, camera)

		// Check if dark mode
		const isDarkMode = document.documentElement.classList.contains( 'dark' )
		
		// Initialize lines with offsets
		const lineArrays = []
		// Color palettes based on theme - lighter/subtler
		const colorPalette = isDarkMode ? [
			// Dark mode: lighter blue gradients
			{ start: 0x4488ff, end: 0xddddff }, // Light blue to very light blue
			{ start: 0x66bbff, end: 0xffffff }, // Light cyan to white
			{ start: 0x8866ff, end: 0xffffff }, // Light purple to white
		] : [
			// Light mode: lighter/gray gradients
			{ start: 0x444444, end: 0x999999 }, // Dark gray to light gray
			{ start: 0x666666, end: 0x444444 }, // Medium gray to dark gray
			{ start: 0x444444, end: 0x666699 }, // Dark gray to blue-gray
		]
		
		for ( let i = 0; i < NUM_LINES; i++ ) {
			const angle = ( i / NUM_LINES ) * Math.PI * 2
			const radius = 0.02
			const offset = new THREE.Vector3( 
				Math.cos( angle ) * radius,
				Math.sin( angle ) * radius,
				0 
			)
			
			// Initialize points
			const points = Array( NUM_POINTS ).fill().map( () => offset.clone() )
			const positionsF32 = new Float32Array( NUM_POINTS * 3 )
			
			points.forEach( ( p, j ) => {
				positionsF32.set( [p.x, p.y, p.z], j * 3 )
			} )
			
			const colors = colorPalette[i % colorPalette.length]
			lines.push( {
				points,
				positionsF32,
				offset,
				velocity: new THREE.Vector3(),
				spring: 0.04 + Math.random() * 0.02,
				friction: 0.9 + Math.random() * 0.05,
				startColor: new THREE.Color( colors.start ),
				endColor: new THREE.Color( colors.end )
			} )
			lineArrays.push( positionsF32 )
		}
		
		// Create MeshLine with simple material
		meshline = new MeshLine()
			.lines( lineArrays, false )
			.lineWidth(0.002)  // Start very thin
			// .transparent(true)
			// .opacity(0.8)
			
		// Use simple width taper
		meshline.widthCallback( ( t ) => {
			const edge = 0.2
			if ( t < edge ) return THREE.MathUtils.lerp( 0.05, 1, t / edge )
			if ( t > 1 - edge ) return THREE.MathUtils.lerp( 0.05, 1, ( 1 - t ) / edge )
			return 1
		} )
		
		// Build the mesh
		meshline.build()
		meshline.material.blending = AdditiveBlending
		
		// Apply gradient colors for each line
		const { Fn, vec4, attribute } = await import( 'three/tsl' )
		meshline.colorFn( Fn( ( [ , progress ] ) => {
			const lineIndex = attribute( 'lineIndex', 'float' )
			const lineColor = attribute( 'lineColor', 'vec3' )
			const lineEndColor = attribute( 'lineEndColor', 'vec3' )
			
			// Interpolate between start and end color based on progress
			const color = lineColor.mix( lineEndColor, progress )
			return vec4( color, 0.6 )
		} ) )
		
		// Set color attributes for each line
		const totalVertices = NUM_LINES * NUM_POINTS * 2
		const colorArray = new Float32Array( totalVertices * 3 )
		const endColorArray = new Float32Array( totalVertices * 3 )
		const lineIndexArray = new Float32Array( totalVertices )
		
		for ( let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++ ) {
			const line = lines[lineIdx]
			const startVertex = lineIdx * NUM_POINTS * 2
			
			for ( let i = 0; i < NUM_POINTS * 2; i++ ) {
				colorArray.set( [line.startColor.r, line.startColor.g, line.startColor.b], ( startVertex + i ) * 3 )
				endColorArray.set( [line.endColor.r, line.endColor.g, line.endColor.b], ( startVertex + i ) * 3 )
				lineIndexArray[startVertex + i] = lineIdx
			}
		}
		
		meshline.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )
		meshline.geometry.setOrUpdateAttribute( 'lineEndColor', endColorArray, 3 )
		meshline.geometry.setOrUpdateAttribute( 'lineIndex', lineIndexArray, 1 )
		
		scene.add( meshline )
		
		// Mouse tracking and link detection
		const handleMouseMove = ( e ) => {
			const prevX = targetMouse.x
			const prevY = targetMouse.y
			// Use normalized device coordinates properly
			targetMouse.x = ( e.clientX / window.innerWidth ) * 2 - 1
			targetMouse.y = -( e.clientY / window.innerHeight ) * 2 + 1
			mouse.moveX = targetMouse.x - prevX
			mouse.moveY = targetMouse.y - prevY
			
			// Check if hovering over a link
			const element = document.elementFromPoint( e.clientX, e.clientY )
			const link = element?.closest( 'a' )
			
			if ( link && link.getBoundingClientRect ) {
				const rect = link.getBoundingClientRect()
				// Check if it's specifically a left sidebar link (not right aside or other navigation)
				const isSidebarLink = link.closest( '.VPSidebar' ) || link.closest( '.VPSidebarItem' ) || 
									  (link.closest( '[class*="sidebar"]' ) && rect.left < window.innerWidth * 0.3)
				
				if ( isSidebarLink ) {
					// Small circle on the left of sidebar links
					orbitTarget = {
						x: ( rect.left - 10 ) / window.innerWidth * 2 - 1,  // Position to the left
						y: -( rect.top + rect.height / 2 ) / window.innerHeight * 2 + 1,
						width: 0.015,  // Small fixed circle size
						height: 0.015,  // Small fixed circle size
						isSidebar: true
					}
				} else {
					// Normal orbit around other links
					orbitTarget = {
						x: ( rect.left + rect.width / 2 ) / window.innerWidth * 2 - 1,
						y: -( rect.top + rect.height / 2 ) / window.innerHeight * 2 + 1,
						width: rect.width / window.innerWidth,
						height: rect.height / window.innerHeight,
						isSidebar: false
					}
				}
			} else {
				orbitTarget = null
				orbitTime = 0
			}
		}
		
		const handleResize = () => {
			camera.aspect = window.innerWidth / window.innerHeight
			camera.updateProjectionMatrix()
			renderer.setSize( window.innerWidth, window.innerHeight )
		}
		
		window.addEventListener( 'mousemove', handleMouseMove )
		window.addEventListener( 'resize', handleResize )
		
		// Watch for theme changes
		const themeObserver = new MutationObserver( () => {
			const nowDarkMode = document.documentElement.classList.contains( 'dark' )
			const newPalette = nowDarkMode ? [
				{ start: 0x4488ff, end: 0xddddff },
				{ start: 0x66bbff, end: 0xffffff },
				{ start: 0x8866ff, end: 0xffffff },
			] : [
				{ start: 0x444444, end: 0x999999 },
				{ start: 0x666666, end: 0x444444 },
				{ start: 0x444444, end: 0x666699 },
			]
			
			// Update line colors
			lines.forEach( ( line, idx ) => {
				const colors = newPalette[idx % newPalette.length]
				line.startColor = new THREE.Color( colors.start )
				line.endColor = new THREE.Color( colors.end )
			} )
			
			// Update color attributes
			const totalVertices = NUM_LINES * NUM_POINTS * 2
			const colorArray = new Float32Array( totalVertices * 3 )
			const endColorArray = new Float32Array( totalVertices * 3 )
			
			for ( let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++ ) {
				const line = lines[lineIdx]
				const startVertex = lineIdx * NUM_POINTS * 2
				
				for ( let i = 0; i < NUM_POINTS * 2; i++ ) {
					colorArray.set( [line.startColor.r, line.startColor.g, line.startColor.b], ( startVertex + i ) * 3 )
					endColorArray.set( [line.endColor.r, line.endColor.g, line.endColor.b], ( startVertex + i ) * 3 )
				}
			}
			
			meshline.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )
			meshline.geometry.setOrUpdateAttribute( 'lineEndColor', endColorArray, 3 )
		} )
		
		themeObserver.observe( document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		} )
		
		// Animation loop
		const animate = () => {
			animationId = requestAnimationFrame( animate )
			
			// Calculate world position considering camera FOV and aspect ratio
			const aspect = window.innerWidth / window.innerHeight
			const fovRad = ( camera.fov * Math.PI ) / 180
			const halfHeight = Math.tan( fovRad / 2 ) * camera.position.z
			const halfWidth = halfHeight * aspect
			
			let worldMouse
			
			if ( orbitTarget ) {
				// Orbit around the link
				orbitTime += 0.05 // Faster rotation (was 0.02)
				
				// Calculate ellipse dimensions based on link size
				const ellipseWidth = orbitTarget.width * halfWidth * 2 + 0.5
				const ellipseHeight = orbitTarget.height * halfHeight * 2 + 0.5
				
				// Create orbital positions for each line with different phases
				mouse.x = orbitTarget.x
				mouse.y = orbitTarget.y
				
				worldMouse = new THREE.Vector3(
					orbitTarget.x * halfWidth,
					orbitTarget.y * halfHeight,
					0
				)
			} else {
				// Normal mouse following
				mouse.x = THREE.MathUtils.lerp( mouse.x, targetMouse.x, 0.1 )
				mouse.y = THREE.MathUtils.lerp( mouse.y, targetMouse.y, 0.1 )
				
				worldMouse = new THREE.Vector3( 
					mouse.x * halfWidth,
					mouse.y * halfHeight,
					0 
				)
			}
			
			// Update lines
			lines.forEach( ( line, index ) => {
				let target
				
				if ( orbitTarget ) {
					if ( orbitTarget.isSidebar ) {
						// Very small circular orbit for sidebar links
						const phase = ( index / NUM_LINES ) * Math.PI * 2  // Restore phase for sidebar
						const angle = orbitTime * 3 + phase  // Faster rotation for small circle
						const radius = 0.02  // Even smaller circle radius (was 0.04)
						
						target = new THREE.Vector3(
							worldMouse.x + Math.cos( angle ) * radius,
							worldMouse.y + Math.sin( angle ) * radius,
							0
						)
					} else {
						// Normal elliptical orbit for other links
						const phase = 0  // No phase for regular links
						const angle = orbitTime * 2 + phase
						
						// Calculate ellipse dimensions
						const ellipseWidth = orbitTarget.width * halfWidth * 0.9 + 0.045
						const ellipseHeight = orbitTarget.height * halfHeight * 0.85 + 0.045
						
						target = new THREE.Vector3(
							worldMouse.x + Math.cos( angle ) * ellipseWidth,
							worldMouse.y + Math.sin( angle ) * ellipseHeight,
							0
						)
					}
				} else {
					// Normal following with offset
					target = worldMouse.clone().add( line.offset )
				}
				
				// Update points from tail to head
				for ( let i = NUM_POINTS - 1; i >= 0; i-- ) {
					if ( i === 0 ) {
						// Head follows mouse with spring physics
						const force = target.clone().sub( line.points[i] ).multiplyScalar( line.spring )
						line.velocity.add( force ).multiplyScalar( line.friction )
						line.points[i].add( line.velocity )
					} else {
						// Rest follow previous point
						line.points[i].lerp( line.points[i - 1], 0.85 )
					}
				}
				
				// Update positions array
				line.points.forEach( ( p, i ) => {
					line.positionsF32.set( [p.x, p.y, p.z], i * 3 )
				} )
			} )
			
			meshline.setPositions( lineArrays )
			
			// Update width based on mouse speed - much smaller when not moving
			const speed = Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) * 50
			// Use gentler curve for more responsive growth
			const normalizedSpeed = Math.min( speed / 2.5, 1 )  // Normalize to 0-1 range, max at speed 2.5
			const curvedSpeed = Math.pow( normalizedSpeed, 1.3 )  // Use 1.3 power for gentler curve
			
			let targetWidth
			if ( orbitTarget ) {
				if ( orbitTarget.isSidebar ) {
					// Ultra thin for sidebar links
					targetWidth = 0.015  // Ultra thin for sidebar (50% of previous)
				} else {
					// Regular thickness for other links
					targetWidth = 0.056  // 30% smaller than 0.08
				}
			} else if ( speed > 0.01 ) {
				// Normal movement-based width
				targetWidth = THREE.MathUtils.lerp( 0.002, 0.3, curvedSpeed )
			} else {
				// Very thin when mouse is still
				targetWidth = 0.002
			}
			
			meshline.material.lineWidth.value = THREE.MathUtils.lerp( 
				meshline.material.lineWidth.value,
				targetWidth,
				0.15
			)
			
			// Fade out mouse movement
			mouse.moveX *= 0.9
			mouse.moveY *= 0.9
			
			renderer.render( scene, camera )
		}
		
		animate()
		
		// Add cleanup functions
		cleanupFunctions.push( () => {
			if ( animationId ) cancelAnimationFrame( animationId )
			window.removeEventListener( 'mousemove', handleMouseMove )
			window.removeEventListener( 'resize', handleResize )
			themeObserver.disconnect()
			if ( renderer ) {
				renderer.dispose()
				canvasContainer.value?.removeChild( renderer.domElement )
			}
		} )
	} catch ( error ) {
		console.warn( 'Trail background initialization failed:', error )
		// Fail silently - the background is decorative
	}
} )
</script>

<style scoped>
.trail-bg-container {
	position: fixed;
	top: 0;
	left: 0;
	width: 100vw;
	height: 100vh;
	pointer-events: none;
	z-index: 100;  /* Above most content but below iframes */
	/* opacity: 0.6; */
}

.trail-bg-container :deep(canvas) {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

/* Hide on mobile */
@media (max-width: 767px) {
	.trail-bg-container {
		display: none;
	}
}

/* Ensure iframes stay above the trail */
:global(iframe) {
	position: relative;
	z-index: 200 !important;
}

/* Ensure example pages iframes are above */
:global(.example-page iframe),
:global(.vp-doc iframe) {
	z-index: 200 !important;
}
</style>