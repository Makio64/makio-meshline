import path from 'path'
import glob from 'fast-glob'
import { exec } from 'child_process'

const AUDIO_FOLDER = 'public/audio/'
let qualities = [64, 96, 128, 192]

async function main() {
	const files = await glob( '**/*+(.mp3)', { cwd: AUDIO_FOLDER, absolute: true } )
	files.forEach( function ( file ) {

		const parsed = path.parse( file )
		let output = AUDIO_FOLDER + path.join( parsed.dir, parsed.name )
		let input = AUDIO_FOLDER + file

		for ( let quality of qualities ) {
			executeCommand( `ffmpeg -i ${input} -c:a aac -b:a ${quality}k -vn ${output}_${quality}.aac` )
			executeCommand( `ffmpeg -i ${input} -c:a libopus -b:a ${quality}k -vn ${output}_${quality}.webm` )
			executeCommand( `ffmpeg -i ${input} -c:a libmp3lame -b:a ${quality}k -vn ${output}_${quality}.mp3` )
		}
	} )
}

function executeCommand( command ) {
	exec( command, ( error, stdout, stderr ) => {
		if ( error ) {
			console.error( `exec error: ${error}` )
			return
		}
		console.log( `stdout: ${stdout}` )
		console.error( `stderr: ${stderr}` )
	} )
}

main()
