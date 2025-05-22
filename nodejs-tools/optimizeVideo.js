import path from 'path'
import { glob } from 'fast-glob'
import { exec } from 'child_process'

async function execute( command ) {
	exec( command, ( error ) => {
		if ( error ) {
			console.log( error )
		}
	} )
}

async function processVideos( folder, resolution ) {
	const files = await glob( '**/*.mov', { cwd: folder } )

	files.forEach( function ( file ) {
		const parsed = path.parse( file )

		let input = path.resolve( folder + '/' + file )
		let output = './' + folder + '_optim/' + path.join( parsed.dir, parsed.name )

		execute( `ffmpeg -i ${input} -vf -frames:v 1 ${output}_frame.jpg` )
		execute( `ffmpeg -i ${input} -c:v libx264 -preset slow -crf 28 -vf "scale=-2:${resolution}" -pix_fmt yuv420p -r 30 -an ${output}_h264.mp4` )
		execute( `ffmpeg -i ${input} -c:v libx265 -preset slow -crf 28 -vf "scale=-2:${resolution}" -pix_fmt yuv420p -tag:v hvc1 -movflags +faststart -r 30 -an ${output}_h265.mp4` )
		execute( `ffmpeg -i ${input} -c:v libvpx-vp9 -crf 31 -b:v 1M -vf "scale=-2:${resolution}" -pix_fmt yuv420p -an ${output}_vp9.webm` )
		// AV1 is very slow to encode
		// execute(`ffmpeg -i ${input} -c:v libaom-av1 -crf 30 -b:v 0 -vf "scale=-2:${resolution}" -an ${output}_av1.mp4`)
	} )
}

async function main() {
	await processVideos( 'public/videos/720', 720 )
	await processVideos( 'public/videos/480', 480 )
}

main()
