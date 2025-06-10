import ImageTracer from 'imagetracerjs'

export default function canvas2svg( canvas, options ) {
	// more infos : https://github.com/jankovicsandras/imagetracerjs/blob/master/options.md
	let opts = {
		strokewidth: 1,
		scale: 1,
		ltres: 1,
		qtres: 2,
		numberofcolors: 2,
		// pathomit: 8,
		rightangleenhance: true,
		// linefilter: true,
		blurradius: 10,
		blurdelta: 64,
		...options,
	}

	return ImageTracer.imagedataToSVG( canvas.getContext( '2d' ).getImageData( 0, 0, canvas.width, canvas.height ), opts )
}
