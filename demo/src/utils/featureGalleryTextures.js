import { CanvasTexture, RepeatWrapping } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

const createTexture = ( width, height, repeatX, repeatY, draw ) => {
	const canvas = document.createElement( 'canvas' )
	canvas.width = width
	canvas.height = height
	draw( canvas.getContext( '2d' ), width, height )

	const texture = stage3d.own( new CanvasTexture( canvas ) )
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.repeat.set( repeatX, repeatY )
	return texture
}

// A dim checker still reads as "transparency" without blooming.
const drawChecker = ( ctx, width ) => {
	const squareSize = width / 8
	for ( let x = 0; x < 8; x++ ) {
		for ( let y = 0; y < 8; y++ ) {
			ctx.fillStyle = ( x + y ) % 2 === 0 ? '#3a4458' : '#151b28'
			ctx.fillRect( x * squareSize, y * squareSize, squareSize, squareSize )
		}
	}
}

const drawSignals = ( ctx, width, height ) => {
	const gradient = ctx.createLinearGradient( 0, 0, width, 0 )
	gradient.addColorStop( 0, '#071b2d' )
	gradient.addColorStop( 0.45, '#22d3ee' )
	gradient.addColorStop( 0.7, '#f0fdfa' )
	gradient.addColorStop( 1, '#071b2d' )
	ctx.fillStyle = gradient
	ctx.fillRect( 0, 0, width, height )
	ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
	ctx.fillRect( width * 0.68, 0, width * 0.055, height )
}

const drawAlpha = ( ctx, width, height ) => {
	const gradient = ctx.createLinearGradient( 0, 0, width, 0 )
	gradient.addColorStop( 0, '#000000' )
	gradient.addColorStop( 0.3, '#000000' )
	gradient.addColorStop( 0.7, '#ffffff' )
	gradient.addColorStop( 1, '#ffffff' )
	ctx.fillStyle = gradient
	ctx.fillRect( 0, 0, width, height )
}

/** The textures of the gallery cells, released with the demo. */
export const createGalleryTextures = () => ( {
	checker: createTexture( 64, 64, 2, 2, drawChecker ),
	signals: createTexture( 128, 32, 5, 1, drawSignals ),
	alpha: createTexture( 32, 32, 6, 1, drawAlpha ),
} )
