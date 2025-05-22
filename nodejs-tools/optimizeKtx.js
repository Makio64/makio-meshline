import glob from 'fast-glob'
import { promises as fs } from 'fs'
import path from 'path'

const IMG_FOLDER = 'public/img/'
const BACKUP_FOLDER = 'public/img_backup/'

import executeCommand from './utils/executeCommand.mjs'

const backupFile = async ( input ) => {
	const backupPath = input.replace( IMG_FOLDER, BACKUP_FOLDER )
	await fs.mkdir( path.dirname( backupPath ), { recursive: true } )
	await fs.copyFile( input, backupPath )
	return backupPath
}

const restoreFile = async ( backupPath, originalPath ) => {
	await fs.copyFile( backupPath, originalPath )
	await fs.unlink( backupPath )
}

const encodeKTX = async ( input, format ) => {
	const backupPath = await backupFile( input )
	let output = input.replace( /\.\w+$/, `_${format}.ktx2` )
	let toktxPath = 'ktx create'
	let args = ['--encode', format == 'etc1s' ? 'basis-lz' : 'uastc', '--format', 'R8G8B8A8_SRGB', '--assign-oetf', 'srgb']
	if ( format == 'etc1s' ) {
		args.push( '--qlevel', '5', '--clevel', '255' )
	} else {
		// args.push('--astc-perceptual') // astc only
		args.push( '--uastc-rdo' ) // postprocessing, increase the effisciency of the compression
		args.push( '--uastc-quality', '4' ) // qwuality from 0 to 4 (0 is the lowest but most light)
		// args.push('--zlib','9')
		args.push( '--zstd', '20' )

	}
	output = `'${output}'`
	input = `'${input}'`
	let command = `${toktxPath} ${args.join( ' ' )} ${input} ${output}`
	console.log( command )

	await executeCommand( command )
		.then( () => {
			console.log( `Encoded ${format}: ${output}` )
		} )
		.catch( ( err ) => {
			console.log( err )
		} )
	await restoreFile( backupPath, input.replace( /'/g, '' ) )
}

async function calculateTotalSize( files ) {
	let totalSize = 0
	for ( const file of files ) {
		const stats = await fs.stat( file )
		totalSize += stats.size
	}
	return ( totalSize / 1048576 ).toFixed( 2 ) + ' MB'
}

async function main() {
	let imgFiles = await glob( '**/*.png', { cwd: IMG_FOLDER, absolute: true } )
	await Promise.all( imgFiles.map( file => encodeKTX( file, 'etc1s' ) ) ) // images to etc1s ktx2
	await Promise.all( imgFiles.map( file => encodeKTX( file, 'uastc' ) ) ) // images to uastc ktx2

	const etcFiles = await glob( '**/*_etc1s.ktx2', { cwd: IMG_FOLDER, absolute: true } )
	const uastcFiles = await glob( '**/*_uastc.ktx2', { cwd: IMG_FOLDER, absolute: true } )
	const imageSize = await calculateTotalSize( imgFiles )
	const etc1sSize = await calculateTotalSize( etcFiles )
	const uastcSize = await calculateTotalSize( uastcFiles )

	console.log( `Total size of Image files: ${imageSize} bytes` )
	console.log( `Total size of ETC1S files: ${etc1sSize} bytes` )
	console.log( `Total size of UASTC files: ${uastcSize} bytes` )
}

main()
