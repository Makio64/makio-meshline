import glob from 'fast-glob'
import { promises as fs } from 'fs'
import sharp from 'sharp'

const IMG_FOLDER = 'public/img/'

async function convertImage( inputPath, format ) {
	try {
		const image = sharp( inputPath )
		const outputPath = inputPath.replace( /\.\w+$/, `.${format}` )
		// let fileExists = await fs.access(outputPath).then(() => true).catch(() => false)
		// if (fileExists) {
		// 	console.log('File already exists:', outputPath)
		// 	return
		// }
		if ( format === 'webp' ) {
			await image.webp( { quality: 90, effort: 6 } ).toFile( outputPath )
		} else if ( format === 'avif' ) {
			await image.avif( { quality: 80, effort: 9 } ).toFile( outputPath )
		} else if ( format === 'png' ) {
			await image.png( { quality: 90 } ).toFile( outputPath )
		}
		console.log( 'Converted:', outputPath )
	} catch ( error ) {
		console.error( 'Error converting', inputPath, error )
	}
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
	let imgFiles = await glob( '**/*.{jpg,jpeg,png,avif}', { cwd: IMG_FOLDER, absolute: true } )

	// await Promise.all(imgFiles.map(file => convertImage(file, 'webp'))) // images to webp
	await Promise.all( imgFiles.map( file => convertImage( file, 'png' ) ) ) // images to png
	// await Promise.all(imgFiles.map(file => convertImage(file, 'avif'))) // images to avif

	const webpFiles = await glob( '**/*.webp', { cwd: IMG_FOLDER, absolute: true } )
	const png = await glob( '**/*.png', { cwd: IMG_FOLDER, absolute: true } )
	const avifFiles = await glob( '**/*.avif', { cwd: IMG_FOLDER, absolute: true } )

	// const pngSize = await calculateTotalSize(imgFiles)
	const webpSize = await calculateTotalSize( webpFiles )
	const pngSize = await calculateTotalSize( png )
	const avifSize = await calculateTotalSize( avifFiles )

	console.log( `Total size of PNG files: ${pngSize} bytes` )
	console.log( `Total size of WEBP files: ${webpSize} bytes` )
	console.log( `Total size of AVIF files: ${avifSize} bytes` )

	// delete png files
	// await Promise.all(imgFiles.map(file => fs.unlink(file)))
}

main()
