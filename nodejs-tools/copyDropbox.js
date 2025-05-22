import { spawn } from 'child_process'
import { platform, homedir } from 'os'
import path from 'path'
import fs from 'fs'

const FOLDER = 'makioXcelialpz/ModelOptimizer/DevAssets/prod/'
const DIST = 'public/models/'

const getDropboxPath = () => {
	let infoPath
	switch ( platform() ) {
		case 'darwin':
		case 'linux':
			infoPath = path.join( homedir(), '.dropbox', 'info.json' )
			break
		case 'win32':
			infoPath = path.join( process.env.LOCALAPPDATA, 'Dropbox', 'info.json' )
			break
		default:
			throw new Error( 'Unsupported platform' )
	}

	if ( !fs.existsSync( infoPath ) ) {
		throw new Error( 'Dropbox info.json file not found' )
	}

	const info = JSON.parse( fs.readFileSync( infoPath, 'utf8' ) )
	return info.personal.path
}

const dropboxPath = getDropboxPath()
const fullPath = path.join( dropboxPath, FOLDER ).replace( /\\/g, '/' )
const args = [`${fullPath}`, DIST, '--watch']

const exe = spawn( 'copy-and-watch', args, { shell: true } )
exe.stdout.on( 'data', data => { console.log( `${data}` ) } )
exe.stderr.on( 'data', data => { console.log( `${data}` ) } )
exe.on( 'close', code => { console.log( `child process exited with code ${code}` ) } )

console.log( 'Watching for file changes in Dropbox...' )
