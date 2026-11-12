/**
 * Generates the four Wind Tunnel audio stems via ElevenLabs Sound Effects API
 * (`POST https://api.elevenlabs.io/v1/sound-generation`) and writes them to
 * `demo/public/sounds/wind-{low,mid,high,accel}.mp3`.
 *
 * Reads `ELEVENLABS_API_KEY` from `process.env` or `~/.env`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

function loadApiKey() {
	if ( process.env.ELEVENLABS_API_KEY ) return process.env.ELEVENLABS_API_KEY.trim()
	for ( const envPath of [resolve( '.env' ), resolve( homedir(), '.env' )] ) {
		if ( !existsSync( envPath ) ) continue
		for ( const line of readFileSync( envPath, 'utf8' ).split( '\n' ) ) {
			const match = line.match( /^\s*ELEVENLABS_API_KEY\s*=\s*(.+?)\s*$/ )
			if ( match ) return match[1].replace( /^['"]|['"]$/g, '' )
		}
	}
	return null
}

const STEMS = [
	{
		file: 'wind-low.mp3',
		duration: 8,
		prompt: 'Deep continuous aerodynamic wind tunnel turbine fan sub-bass drone and smooth low air pressure hum, seamless steady ambient loop, no music',
	},
	{
		file: 'wind-mid.mp3',
		duration: 8,
		prompt: 'Continuous smooth laminar high-speed airflow rushing past a sleek sports car inside an aerodynamic wind tunnel, clean steady stereo air rush loop',
	},
	{
		file: 'wind-high.mp3',
		duration: 8,
		prompt: 'Intense 400 km/h high-velocity wind tunnel aerodynamic boundary layer shear and futuristic carbon canopy wind whistle, continuous loop',
	},
	{
		file: 'wind-accel.mp3',
		duration: 8,
		prompt: 'Powerful aerodynamic turbine wind tunnel spool-up whoosh and turbulent wake vortex buffeting air rush, continuous loop',
	},
]

const apiKey = loadApiKey()
if ( !apiKey ) {
	console.error( 'Missing ELEVENLABS_API_KEY in environment or ~/.env' )
	process.exit( 1 )
}

const outDir = resolve( 'demo/public/sounds' )
mkdirSync( outDir, { recursive: true } )

for ( const stem of STEMS ) {
	console.log( `Generating ${stem.file}...` )
	const res = await fetch( 'https://api.elevenlabs.io/v1/sound-generation', {
		method: 'POST',
		headers: {
			'xi-api-key': apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( {
			text: stem.prompt,
			duration_seconds: stem.duration,
			prompt_influence: 0.45,
		} ),
	} )
	if ( !res.ok ) {
		throw new Error( `ElevenLabs error (${res.status}): ${await res.text()}` )
	}
	const buffer = Buffer.from( await res.arrayBuffer() )
	writeFileSync( resolve( outDir, stem.file ), buffer )
	console.log( `Saved ${stem.file} (${buffer.byteLength} bytes)` )
}
