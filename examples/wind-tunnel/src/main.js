import './style.css'

import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'

import { createWindTunnel, WIND_TUNNEL_CAMERA } from './scene.js'

const status = document.querySelector( '#status' )
const statusTitle = document.querySelector( '#status-title' )
const statusMessage = document.querySelector( '#status-message' )
const form = document.querySelector( '#controls' )
const motion = matchMedia( '(prefers-reduced-motion: reduce)' )
const compact = matchMedia( '(pointer: coarse)' ).matches || innerWidth < 720
const listeners = new AbortController()

const scene = new Scene()
const camera = new PerspectiveCamera( WIND_TUNNEL_CAMERA.fov, innerWidth / innerHeight, WIND_TUNNEL_CAMERA.near, WIND_TUNNEL_CAMERA.far )
camera.position.fromArray( WIND_TUNNEL_CAMERA.position )

const renderer = new WebGPURenderer( { antialias: true, reverseDepth: true } )
let pixelRatio = Math.min( devicePixelRatio, compact ? 1.25 : 1.75 )
renderer.setPixelRatio( pixelRatio )
renderer.setSize( innerWidth, innerHeight )
renderer.domElement.setAttribute( 'aria-label', 'WebGPU smoke flowing around a hover car' )
document.body.prepend( renderer.domElement )

let tunnel
let orbit
let disposed = false
let paused = false
let previousTime = 0
let slowFrames = 0
let initializing

function listen( target, type, handler, options = {} ) {
	target.addEventListener( type, handler, { ...options, signal: listeners.signal } )
}

function resize() {
	camera.aspect = innerWidth / Math.max( 1, innerHeight )
	camera.updateProjectionMatrix()
	renderer.setPixelRatio( pixelRatio )
	renderer.setSize( innerWidth, innerHeight )
	tunnel?.resize( innerWidth, innerHeight )
}

function animate( now ) {
	if ( disposed || document.hidden ) return
	const dt = previousTime ? Math.min( ( now - previousTime ) * 0.001, 0.05 ) : 1 / 60
	previousTime = now
	if ( !paused ) {
		orbit.update( dt )
		tunnel.update( dt )
	}
	tunnel.render()
	// Sustained slow frames reduce fill cost; the simulation itself stays the same.
	slowFrames = dt > 1 / 28 ? slowFrames + 1 : Math.max( 0, slowFrames - 1 )
	if ( slowFrames >= 60 && pixelRatio > 0.75 ) {
		pixelRatio = Math.max( 0.75, pixelRatio - 0.25 )
		slowFrames = 0
		resize()
	}
}

function fail( error ) {
	status.hidden = false
	statusTitle.textContent = renderer.backend?.isWebGPUBackend ? 'The scene could not start' : 'Native WebGPU is required'
	statusMessage.textContent = `${error.message} Try a WebGPU-enabled browser and device, then reload.`
	form.hidden = true
	renderer.setAnimationLoop( null )
}

async function init() {
	try {
		await renderer.init()
		if ( disposed ) return
		tunnel = await createWindTunnel( {
			renderer,
			scene,
			camera,
			reducedMotion: motion.matches,
			onStatus: message => { statusMessage.textContent = message },
		} )
		if ( disposed ) {
			tunnel.dispose()
			return
		}

		orbit = new OrbitControls( camera, renderer.domElement )
		orbit.target.fromArray( WIND_TUNNEL_CAMERA.target )
		orbit.minDistance = WIND_TUNNEL_CAMERA.minDistance
		orbit.maxDistance = WIND_TUNNEL_CAMERA.maxDistance
		orbit.minPolarAngle = WIND_TUNNEL_CAMERA.minPolarAngle
		orbit.maxPolarAngle = WIND_TUNNEL_CAMERA.maxPolarAngle
		orbit.enableDamping = true
		orbit.autoRotate = !motion.matches
		orbit.autoRotateSpeed = 0.172
		// Give the car room in a portrait viewport without changing its viewing angle.
		if ( camera.aspect < 0.8 ) {
			camera.position.sub( orbit.target ).multiplyScalar( Math.min( 1.5, 0.8 / camera.aspect ) ).add( orbit.target )
		}
		orbit.update()
		resize()
		tunnel.update( 1 / 60 )
		tunnel.render()
		await renderer.backend.device.queue.onSubmittedWorkDone()
		if ( disposed ) return
		status.hidden = true
		form.hidden = false
		installControls()
		renderer.setAnimationLoop( animate )
	} catch ( error ) {
		if ( !disposed ) fail( error )
	}
}

function installControls() {
	listen( window, 'resize', resize )
	listen( renderer.domElement, 'pointermove', event => {
		const rect = renderer.domElement.getBoundingClientRect()
		tunnel.setPointer( ( event.clientX - rect.left ) / rect.width * 2 - 1, 1 - ( event.clientY - rect.top ) / rect.height * 2 )
	}, { passive: true } )
	listen( form, 'submit', event => event.preventDefault() )
	for ( const button of form.querySelectorAll( '[data-mode]' ) ) {
		listen( button, 'click', () => {
			tunnel.setMode( button.dataset.mode )
			for ( const item of form.querySelectorAll( '[data-mode]' ) ) item.setAttribute( 'aria-pressed', String( item === button ) )
		} )
	}
	const crosswind = document.querySelector( '#crosswind' )
	listen( crosswind, 'click', () => {
		tunnel.setCrosswind( !tunnel.settings.crosswind )
		crosswind.setAttribute( 'aria-pressed', String( tunnel.settings.crosswind ) )
	} )
	const wind = document.querySelector( '#wind' )
	listen( wind, 'input', () => {
		tunnel.setWind( Number( wind.value ) )
		document.querySelector( '#wind-value' ).value = `${tunnel.settings.wind} km/h`
	} )
	const pause = document.querySelector( '#pause' )
	listen( pause, 'click', () => {
		paused = !paused
		pause.setAttribute( 'aria-pressed', String( paused ) )
		pause.textContent = paused ? 'Resume' : 'Pause'
	} )
	listen( motion, 'change', () => {
		orbit.autoRotate = !motion.matches
		tunnel.setReducedMotion( motion.matches )
	} )
	listen( document, 'visibilitychange', () => {
		previousTime = 0
		renderer.setAnimationLoop( document.hidden ? null : animate )
	} )
	listen( renderer.domElement, 'webgpucontextlost', () => fail( new Error( 'The graphics device was lost.' ) ) )
	renderer.backend.device.lost.then( info => {
		if ( !disposed ) fail( new Error( `The WebGPU device was lost: ${info.message || info.reason}` ) )
	} )
}

export async function dispose() {
	if ( disposed ) return
	disposed = true
	listeners.abort()
	renderer.setAnimationLoop( null )
	// Let an in-flight model/SDF setup finish before releasing its host device.
	await initializing
	orbit?.dispose()
	tunnel?.dispose()
	await renderer.dispose()
	renderer.domElement.remove()
}

if ( import.meta.hot ) import.meta.hot.dispose( dispose )
initializing = init()
