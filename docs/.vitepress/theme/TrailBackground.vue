<template>
  <div
    ref="canvasContainer"
    class="trail-bg-container"
  />
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

import {
	createTrailMeshLine,
	createTrailPositions,
	stepTrailLine,
	writeTrailAttributes,
} from './trailBackgroundData.js'

const canvasContainer = ref( null )
const NUM_POINTS = 30
const NUM_LINES = 3
const mouse = { x: 0, y: 0, moveX: 0, moveY: 0 }
const targetMouse = { x: 0, y: 0 }
const orbitTarget = { active: false, x: 0, y: 0, width: 0, height: 0, isSidebar: false }

let disposed = false
let cleanup = () => {}

onUnmounted( () => {
	disposed = true
	cleanup()
} )

onMounted( async () => {
	if ( window.innerWidth < 768 ) return

	let animationId = null
	let renderer = null
	let scene = null
	let camera = null
	let meshline = null
	let themeObserver = null
	let motionQuery = null
	let listenersAttached = false
	let lines = []
	let orbitTime = 0
	let customAttributeBuffer = null
	let cleaned = false

	const shouldAnimate = () => (
		!disposed &&
		!document.hidden &&
		window.innerWidth >= 768 &&
		!motionQuery?.matches
	)

	const stopAnimation = () => {
		if ( animationId !== null ) cancelAnimationFrame( animationId )
		animationId = null
	}

	let animate = () => {}
	const startAnimation = () => {
		if ( animationId === null && shouldAnimate() ) {
			animationId = requestAnimationFrame( animate )
		}
	}

	const syncAnimation = () => {
		if ( shouldAnimate() ) startAnimation()
		else stopAnimation()
	}

	const handleResize = () => {
		if ( !camera || !renderer ) return
		camera.aspect = window.innerWidth / window.innerHeight
		camera.updateProjectionMatrix()
		renderer.setSize( window.innerWidth, window.innerHeight )
		syncAnimation()
	}

	const handleMouseMove = ( event ) => {
		const previousX = targetMouse.x
		const previousY = targetMouse.y
		targetMouse.x = ( event.clientX / window.innerWidth ) * 2 - 1
		targetMouse.y = -( event.clientY / window.innerHeight ) * 2 + 1
		mouse.moveX = targetMouse.x - previousX
		mouse.moveY = targetMouse.y - previousY

		const element = document.elementFromPoint( event.clientX, event.clientY )
		const link = element?.closest( 'a' )
		if ( !link?.getBoundingClientRect ) {
			orbitTarget.active = false
			orbitTime = 0
			return
		}

		const rect = link.getBoundingClientRect()
		const isSidebarLink = !!(
			link.closest( '.VPSidebar' ) ||
			link.closest( '.VPSidebarItem' ) ||
			( link.closest( '[class*="sidebar"]' ) && rect.left < window.innerWidth * 0.3 )
		)

		orbitTarget.active = true
		orbitTarget.isSidebar = isSidebarLink
		if ( isSidebarLink ) {
			orbitTarget.x = ( rect.left - 10 ) / window.innerWidth * 2 - 1
			orbitTarget.y = -( rect.top + rect.height / 2 ) / window.innerHeight * 2 + 1
			orbitTarget.width = 0.015
			orbitTarget.height = 0.015
		} else {
			orbitTarget.x = ( rect.left + rect.width / 2 ) / window.innerWidth * 2 - 1
			orbitTarget.y = -( rect.top + rect.height / 2 ) / window.innerHeight * 2 + 1
			orbitTarget.width = rect.width / window.innerWidth
			orbitTarget.height = rect.height / window.innerHeight
		}
	}

	const removeMotionListener = () => {
		if ( motionQuery?.removeEventListener ) motionQuery.removeEventListener( 'change', syncAnimation )
		else motionQuery?.removeListener?.( syncAnimation )
	}

	cleanup = () => {
		if ( cleaned ) return
		cleaned = true
		stopAnimation()
		if ( listenersAttached ) {
			window.removeEventListener( 'mousemove', handleMouseMove )
			window.removeEventListener( 'resize', handleResize )
			document.removeEventListener( 'visibilitychange', syncAnimation )
			removeMotionListener()
		}
		themeObserver?.disconnect()
		if ( meshline ) {
			scene?.remove( meshline )
			meshline.dispose()
		}
		if ( renderer ) {
			renderer.dispose()
			renderer.domElement.remove()
		}
		customAttributeBuffer = null
		meshline = null
		renderer = null
		scene = null
		camera = null
		lines = []
	}

	try {
		const [THREE, { MeshLine }, { Fn, attribute, vec4 }] = await Promise.all( [
			import( 'three/webgpu' ),
			import( 'makio-meshline' ),
			import( 'three/tsl' ),
		] )
		if ( disposed ) return

		renderer = new THREE.WebGPURenderer( {
			antialias: true,
			alpha: true,
			powerPreference: 'high-performance',
		} )
		renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
		renderer.setSize( window.innerWidth, window.innerHeight )
		renderer.setClearColor( 0x000000, 0 )
		await renderer.init()
		if ( disposed ) {
			cleanup()
			return
		}
		canvasContainer.value.appendChild( renderer.domElement )

		scene = new THREE.Scene()
		camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.1, 100 )
		camera.position.z = 5

		const lineArrays = []
		for ( let i = 0; i < NUM_LINES; i++ ) {
			const angle = ( i / NUM_LINES ) * Math.PI * 2
			const radius = 0.02
			const offsetX = Math.cos( angle ) * radius
			const offsetY = Math.sin( angle ) * radius
			const positions = createTrailPositions( NUM_POINTS, offsetX, offsetY )

			lines.push( {
				positions,
				offsetX,
				offsetY,
				velocityX: 0,
				velocityY: 0,
				spring: 0.04 + Math.random() * 0.02,
				friction: 0.9 + Math.random() * 0.05,
				startColor: new THREE.Color(),
				endColor: new THREE.Color(),
			} )
			lineArrays.push( positions )
		}

		const trail = createTrailMeshLine( {
			MeshLine,
			lineArrays,
			lerp: THREE.MathUtils.lerp,
			Fn,
			attribute,
			vec4,
			blending: THREE.AdditiveBlending,
		} )
		meshline = trail.meshline
		customAttributeBuffer = trail.customAttributeBuffer

		const applyPalette = () => {
			const isDarkMode = document.documentElement.classList.contains( 'dark' )
			const palette = isDarkMode ? [
				{ start: 0x4488ff, end: 0xddddff },
				{ start: 0x66bbff, end: 0xffffff },
				{ start: 0x8866ff, end: 0xffffff },
			] : [
				{ start: 0x00cc88, end: 0x66ffcc },
				{ start: 0x00bbaa, end: 0x44ddcc },
				{ start: 0x00aacc, end: 0x66ddff },
			]

			for ( let lineIndex = 0; lineIndex < lines.length; lineIndex++ ) {
				const colors = palette[lineIndex % palette.length]
				lines[lineIndex].startColor.set( colors.start )
				lines[lineIndex].endColor.set( colors.end )
			}
			writeTrailAttributes( customAttributeBuffer.array, lines, NUM_POINTS )
			customAttributeBuffer.needsUpdate = true
		}

		applyPalette()
		scene.add( meshline )

		themeObserver = new MutationObserver( applyPalette )
		themeObserver.observe( document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		} )

		motionQuery = window.matchMedia( '(prefers-reduced-motion: reduce)' )
		if ( motionQuery.addEventListener ) motionQuery.addEventListener( 'change', syncAnimation )
		else motionQuery.addListener?.( syncAnimation )
		window.addEventListener( 'mousemove', handleMouseMove )
		window.addEventListener( 'resize', handleResize )
		document.addEventListener( 'visibilitychange', syncAnimation )
		listenersAttached = true

		animate = () => {
			animationId = null
			if ( !shouldAnimate() ) return

			const aspect = window.innerWidth / window.innerHeight
			const fovRad = ( camera.fov * Math.PI ) / 180
			const halfHeight = Math.tan( fovRad / 2 ) * camera.position.z
			const halfWidth = halfHeight * aspect
			let worldMouseX
			let worldMouseY

			if ( orbitTarget.active ) {
				orbitTime += 0.05
				mouse.x = orbitTarget.x
				mouse.y = orbitTarget.y
				worldMouseX = orbitTarget.x * halfWidth
				worldMouseY = orbitTarget.y * halfHeight
			} else {
				mouse.x = THREE.MathUtils.lerp( mouse.x, targetMouse.x, 0.1 )
				mouse.y = THREE.MathUtils.lerp( mouse.y, targetMouse.y, 0.1 )
				worldMouseX = mouse.x * halfWidth
				worldMouseY = mouse.y * halfHeight
			}

			for ( let lineIndex = 0; lineIndex < lines.length; lineIndex++ ) {
				const line = lines[lineIndex]
				let targetX
				let targetY
				if ( orbitTarget.active ) {
					if ( orbitTarget.isSidebar ) {
						const phase = ( lineIndex / NUM_LINES ) * Math.PI * 2
						const angle = orbitTime * 3 + phase
						targetX = worldMouseX + Math.cos( angle ) * 0.02
						targetY = worldMouseY + Math.sin( angle ) * 0.02
					} else {
						const angle = orbitTime * 2
						const ellipseWidth = orbitTarget.width * halfWidth * 0.9 + 0.045
						const ellipseHeight = orbitTarget.height * halfHeight * 0.85 + 0.045
						targetX = worldMouseX + Math.cos( angle ) * ellipseWidth
						targetY = worldMouseY + Math.sin( angle ) * ellipseHeight
					}
				} else {
					targetX = worldMouseX + line.offsetX
					targetY = worldMouseY + line.offsetY
				}
				stepTrailLine( line, targetX, targetY, NUM_POINTS )
			}

			meshline.setPositions( lineArrays )
			const speed = Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) * 50
			const normalizedSpeed = Math.min( speed / 2.5, 1 )
			const curvedSpeed = Math.pow( normalizedSpeed, 1.3 )
			let targetWidth
			if ( orbitTarget.active ) {
				targetWidth = orbitTarget.isSidebar ? 0.015 : 0.056
			} else if ( speed > 0.01 ) {
				targetWidth = THREE.MathUtils.lerp( 0.002, 0.3, curvedSpeed )
			} else {
				targetWidth = 0.002
			}

			meshline.material.lineWidth.value = THREE.MathUtils.lerp(
				meshline.material.lineWidth.value,
				targetWidth,
				0.15,
			)
			mouse.moveX *= 0.9
			mouse.moveY *= 0.9
			renderer.render( scene, camera )
			startAnimation()
		}

		if ( !document.hidden ) renderer.render( scene, camera )
		syncAnimation()
	} catch ( error ) {
		console.warn( 'Trail background initialization failed:', error )
		cleanup()
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
