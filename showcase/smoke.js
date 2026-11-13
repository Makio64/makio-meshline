/**
 * Smoke test for the shared scaffold: stage + bloom, MeshLine (gradient, round join),
 * ultra-text title + 773× counter, David → Venus ring stack, 3-page pager.
 * window.__smoke exposes everything for automated checks.
 */
import './shared/base.css'

import { MeshLine } from 'makio-meshline'
import { REVISION, Vector3 } from 'three/webgpu'

import { num } from './shared/numbers.js'
import { createPager } from './shared/pager.js'
import { createStage } from './shared/stage.js'
import { createRingStack, loadStatueRings } from './shared/statues.js'
import { createCounter, createText, loadFonts } from './shared/text.js'

const SPACING = 16
const BG = 0x05060a

const status = document.createElement( 'div' )
status.className = 'ui-corner tl'
status.innerHTML = 'smoke · booting'
document.body.append( status )
const log = ( s ) => { status.innerHTML = `smoke · ${s} · <a href="./">hub</a>` }

const stage = await createStage( { background: BG, bloom: { strength: 0.9, radius: 0.4, threshold: 0 } } )
const { scene, camera, renderer } = stage
camera.position.set( 0, 0, 18 )
log( `${stage.backend} · r${REVISION} · fonts` )

await loadFonts( ['800 1em Inter', '400 1em JetBrains Mono'] )

//------------------------------------------------------------------ PAGE 0: MeshLine trefoil (gradient + round join)
const knot = new Float32Array( 400 * 3 )
for ( let i = 0; i < 400; i++ ) {
	const t = ( i / 400 ) * Math.PI * 2
	knot[i * 3] = ( Math.sin( t ) + 2 * Math.sin( 2 * t ) ) * 1.6
	knot[i * 3 + 1] = ( Math.cos( t ) - 2 * Math.cos( 2 * t ) ) * 1.6
	knot[i * 3 + 2] = -Math.sin( 3 * t ) * 1.6
}
const line = new MeshLine()
	.lines( knot, true )
	.lineWidth( 0.22 )
	.color( 0x22d3ee )
	.gradientColor( 0xff3df0 )
	.join( { type: 'round' } )
	.autoResize()
line.position.set( 0, 0.6, 0 )
scene.add( line )

const title = await createText( renderer, 'MeshLine v2', { fontFamily: 'Inter', fontWeight: 800, letterSpacing: '-0.04em' }, { size: 1.1, glow: 1.2, backdrop: BG } )
title.position.set( 0, -5.4, 0 )
scene.add( title )
log( `${stage.backend} · text ok` )

//------------------------------------------------------------------ PAGE 1: 773× counter
const upload = num( 'upload773' )
const counter = await createCounter( renderer, { template: '000×', css: { fontFamily: 'Inter', fontWeight: 800, letterSpacing: '-0.05em' }, size: 5, glow: 1.6, backdrop: BG } )
counter.position.set( SPACING, 0.4, 0 )
scene.add( counter )
const caption = await createText( renderer, `${upload.label} · vs ${'v1.2.3'}`, { fontFamily: 'JetBrains Mono', fontWeight: 400, color: '#9aa0a6' }, { size: 0.32, backdrop: BG } )
caption.position.set( SPACING, -3.6, 0 )
scene.add( caption )
log( `${stage.backend} · counter ok` )

//------------------------------------------------------------------ PAGE 2: David → Venus rings
const [david, venus] = await Promise.all( [loadStatueRings( 'david' ), loadStatueRings( 'venus' )] )
const stack = createRingStack( [david, venus], { lineWidth: 0.03, intensity: 1.2 } )
stack.line.position.set( SPACING * 2, 0, 0 )
scene.add( stack.line )
log( `${stage.backend} · rings ok` )

//------------------------------------------------------------------ PAGER
const pager = createPager( { count: 3, stage, labels: ['MeshLine', '773×', 'David → Venus'] } )
const look = new Vector3()

stage.onFrame( ( dt, t ) => {
	const p = pager.progress
	camera.position.set( p * SPACING + Math.sin( t * 0.3 ) * 0.6, 0.4, 18 - pager.presence( 2 ) * 2 )
	look.set( p * SPACING, 0, 0 )
	camera.lookAt( look )

	line.rotation.y = t * 0.25
	title.opacity.value = 0.25 + 0.75 * pager.presence( 0 )

	// scroll-scrubbed count: rewinds when scrolling back
	const k = Math.max( 0, 1 - Math.abs( pager.local( 1 ) ) )
	const eased = 1 - Math.pow( 1 - k, 3 )
	counter.setValue( Math.round( upload.nums[0] * eased ), { scramble: k < 0.98 ? 0.25 : 0 } )
	caption.reveal.value = k

	stack.morph.value = Math.max( 0, Math.min( 1, ( pager.local( 2 ) + 0.6 ) / 0.6 ) ) // 0 david → 1 venus as page 2 centres
	stack.line.rotation.y = t * 0.2
	stage.setBloom( 0.6 + 0.6 * pager.presence( 2 ) )
} )

log( `${stage.backend} · r${REVISION} · ready` )
window.__smoke = { stage, pager, counter, title, caption, line, stack, REVISION, ready: true }
