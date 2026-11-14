/**
 * Records the pipelines a built standalone app creates up to its first complete frame, into
 * demo/src/<app>/pipelines.json, which the app compiles ahead of its scene (demo/src/standalone/fastStart.js).
 *
 *   pnpm capture:rice-field                                    build, record, build with the recording
 *   node scripts/capture-pipelines.mjs rice-field --check      is the recording still the app's?
 *
 * Record again after a change to the app's shaders, three or the renderer settings: a stale entry
 * compiles something nothing uses, and a missing one compiles late, as without a recording.
 * Recorded in desktop Chrome at 1280×800, where the app takes its desktop quality.
 *
 * Set CHROME_PATH when Chrome is not in a default location.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openPage, serveDirectory } from './headless-chrome.mjs'

const ROOT = resolve( fileURLToPath( import.meta.url ), '../..' )
const app = process.argv[2]
const check = process.argv.includes( '--check' )
if ( !app || app.startsWith( '--' ) ) throw new Error( 'Usage: node scripts/capture-pipelines.mjs <app> [--check]' )
const output = resolve( ROOT, 'demo/src', app, 'pipelines.json' )

/** Runs in the page before its scripts: every pipeline, its shaders and its layouts, as data. */
function record() {
	if ( !globalThis.GPUDevice ) return
	const capture = { shaders: [], pipelines: [], done: false }
	globalThis.__pipelineCapture = capture
	const records = new WeakMap()
	// Plain descriptor data with sorted keys; labels only on pipelines and override constants.
	const normalize = ( value, keepLabels = false ) => {
		if ( value === null || typeof value !== 'object' ) return value
		if ( records.has( value ) ) return records.get( value )
		if ( Array.isArray( value ) ) return value.map( entry => normalize( entry ) )
		return Object.fromEntries( Object.keys( value ).sort()
			.filter( key => ( keepLabels || key !== 'label' ) && value[key] !== undefined )
			.map( key => [key, normalize( value[key], key === 'constants' )] ) )
	}
	const prototype = GPUDevice.prototype
	for ( const method of ['createShaderModule', 'createBindGroupLayout', 'createPipelineLayout'] ) {
		const original = prototype[method]
		prototype[method] = function ( descriptor ) {
			const object = original.call( this, descriptor )
			if ( method !== 'createShaderModule' ) records.set( object, normalize( descriptor ) )
			else {
				let shader = capture.shaders.indexOf( descriptor.code )
				if ( shader < 0 ) shader = capture.shaders.push( descriptor.code ) - 1
				records.set( object, { shader } )
			}
			return object
		}
	}
	for ( const method of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync'] ) {
		const original = prototype[method]
		prototype[method] = function ( descriptor ) {
			// JSON cannot keep a -0 override: such an entry is left to the app.
			const signedZero = ['vertex', 'fragment', 'compute'].some( stage => Object.values( descriptor[stage]?.constants ?? {} ).some( value => Object.is( value, -0 ) ) )
			if ( !capture.done && !signedZero ) {
				capture.pipelines.push( {
					// Without three's numbering, which says nothing about the pipeline.
					label: String( descriptor.label ?? '' ).replace( /_\d+$/, '' ),
					// The app waits on these: they compile first.
					...method.endsWith( 'Async' ) ? {} : { sync: true },
					descriptor: normalize( descriptor ),
				} )
			}
			return original.call( this, descriptor )
		}
	}
}

async function capture() {
	const server = await serveDirectory( resolve( ROOT, 'dist', app ) )
	const page = await openPage( `${server.origin}/`, { init: `(${record})()`, dpr: 2, timeout: 120000 } )
	try {
		await page.waitFor( `'ready' in document.documentElement.dataset` )
		const result = await page.evaluate( `(() => {
			const capture = globalThis.__pipelineCapture
			capture.done = true
			return { fingerprint: capture.fingerprint, shaders: capture.shaders, pipelines: capture.pipelines }
		})()` )
		if ( !result.fingerprint ) throw new Error( 'The app has no fast start, or no WebGPU: nothing recorded' )
		return result
	} finally {
		await page.close()
		server.close()
	}
}

/** Each pipeline as one string, its shaders' sources in place of their indices; repeats once. */
function entries( { shaders, pipelines } ) {
	const keys = new Map()
	for ( const { sync, descriptor } of pipelines ) {
		const key = JSON.stringify( descriptor, ( name, value ) => value?.shader !== undefined && Object.keys( value ).length === 1 ? shaders[value.shader] : value )
		keys.set( key, { sync: sync === true } )
	}
	return keys
}

const recorded = await capture()
const unique = entries( recorded )
if ( check ) {
	const stored = entries( JSON.parse( readFileSync( output, 'utf8' ) ) )
	const stale = [...stored.keys()].filter( key => !unique.has( key ) ).length
	const missing = [...unique.keys()].filter( key => !stored.has( key ) ).length
	console.log( `${app}: ${unique.size} pipelines, ${stale} stale and ${missing} missing in ${output}` )
	process.exitCode = stale || missing ? 1 : 0
} else {
	// Repeats once, and only the shaders they use, in the order the app created them.
	const seen = new Set()
	const shaders = []
	const index = new Map()
	const pipelines = []
	for ( const entry of recorded.pipelines ) {
		const key = JSON.stringify( entry.descriptor, ( name, value ) => value?.shader !== undefined && Object.keys( value ).length === 1 ? recorded.shaders[value.shader] : value )
		if ( seen.has( key ) ) continue
		seen.add( key )
		const descriptor = JSON.parse( JSON.stringify( entry.descriptor, ( name, value ) => {
			if ( value?.shader === undefined || Object.keys( value ).length !== 1 ) return value
			const code = recorded.shaders[value.shader]
			if ( !index.has( code ) ) index.set( code, shaders.push( code ) - 1 )
			return { shader: index.get( code ) }
		} ) )
		pipelines.push( { ...entry, descriptor } )
	}
	writeFileSync( output, `${JSON.stringify( { version: 1, fingerprint: recorded.fingerprint, shaders, pipelines } )}\n` )
	console.log( `${app}: ${pipelines.length} pipelines (${pipelines.filter( entry => entry.sync ).length} synchronous), ${shaders.length} shaders → ${output}` )
}
