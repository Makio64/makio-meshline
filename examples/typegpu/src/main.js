import './style.css'

import { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'

import { amplitude, createRibbons, elapsed } from './ribbons.js'

const canvas = document.querySelector( '#scene' )
const status = document.querySelector( '#status' )
const pauseButton = document.querySelector( '#pause' )
const amplitudeSlider = document.querySelector( '#amplitude' )
const motionQuery = window.matchMedia( '(prefers-reduced-motion: reduce)' )
let running = !motionQuery.matches
let renderer
let ribbons
let failure = null

function reportFailure( error ) {
	if ( failure === error ) return
	failure = error
	running = false
	status.textContent = error.message
	status.classList.add( 'error' )
	pauseButton.disabled = true
	amplitudeSlider.disabled = true
	renderer?.setAnimationLoop( null )
	console.error( error )
}

function resize() {
	const width = window.innerWidth
	const height = window.innerHeight
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
	renderer.setSize( width, height )
	camera.aspect = width / height
	// Frame the whole batch on narrow screens while keeping the controls clear.
	camera.position.z = Math.max( 9, 5.5 / ( camera.aspect * Math.tan( camera.fov * Math.PI / 360 ) ) )
	camera.updateProjectionMatrix()
	ribbons.resize( width, height )
}

function syncPauseButton() {
	pauseButton.textContent = running ? 'Pause' : 'Play'
	pauseButton.setAttribute( 'aria-label', running ? 'Pause ribbon animation' : 'Play ribbon animation' )
}

const scene = new Scene()
const camera = new PerspectiveCamera( 42, 1, 0.1, 100 )

async function start() {
	if ( !navigator.gpu ) throw new Error( 'This example needs a browser with native WebGPU enabled.' )
	renderer = new WebGPURenderer( { canvas, antialias: true } )
	// Use the renderer's public callbacks to surface asynchronous GPU failures.
	renderer.onError = info => reportFailure( new Error( info.message ) )
	renderer.onDeviceLost = info => reportFailure( new Error( info.message ) )
	await renderer.init()
	if ( !renderer.backend.isWebGPUBackend ) {
		throw new Error( 'WebGPU is unavailable on this device. The TypeGPU bridge example requires the native WebGPU backend.' )
	}
	renderer.setClearColor( 0x090d16 )
	ribbons = createRibbons()
	scene.add( ribbons )
	resize()
	await renderer.compileAsync( scene, camera )
	if ( failure ) throw failure
	status.textContent = 'Native WebGPU · TypeGPU shader preview'
	pauseButton.disabled = false
	amplitudeSlider.disabled = false
	syncPauseButton()

	let previousTime
	renderer.setAnimationLoop( milliseconds => {
		const delta = previousTime === undefined ? 0 : Math.min( ( milliseconds - previousTime ) / 1000, 0.05 )
		previousTime = milliseconds
		if ( running ) elapsed.value += delta
		try {
			renderer.render( scene, camera )
		} catch ( error ) {
			reportFailure( error )
		}
	} )
	window.addEventListener( 'resize', resize )
}

pauseButton.addEventListener( 'click', () => {
	running = !running
	syncPauseButton()
} )
amplitudeSlider.addEventListener( 'input', () => { amplitude.value = Number( amplitudeSlider.value ) } )
motionQuery.addEventListener( 'change', () => {
	running = !motionQuery.matches
	syncPauseButton()
} )

// Dispose the GPU resources on permanent navigation, preserving browser back/forward cache.
window.addEventListener( 'pagehide', event => {
	if ( event.persisted ) return
	window.removeEventListener( 'resize', resize )
	renderer?.setAnimationLoop( null )
	ribbons?.dispose()
	renderer?.dispose()
} )

start().catch( error => {
	reportFailure( error )
	ribbons?.dispose()
	renderer?.dispose()
} )
