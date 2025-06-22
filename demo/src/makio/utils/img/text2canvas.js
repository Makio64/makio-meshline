import stage3d from '@/makio/three/stage3d'

/**
 * @author Makio64 <info@makiopolis.com>
 * @description Converts text into a canvas element with customizable styling and layout options.
 * Supports multi-line text with word wrapping and vertical flipping for WebGPU compatibility.
 *
 * @param {string} text - The text to render on the canvas
 * @param {Object} options - Configuration options
 * @param {string} [options.fontFamily='Helvetica'] - Font family to use
 * @param {number} [options.weight=400] - Font weight
 * @param {number} [options.fontSize=64] - Font size in pixels
 * @param {number} [options.margin=64] - Margin around the text in pixels
 * @param {string} [options.color='white'] - Text color
 * @param {string} [options.background='white'] - Background color
 * @param {number} [options.maxWidth] - Maximum width for text wrapping
 * @param {number} [options.scaleX=1] - Horizontal scale factor
 * @param {number} [options.lineHeight=1.2] - Line height multiplier
 * @param {number} [options.letterSpacing=0] - Letter spacing in pixels
 * @param {boolean} [options.flipY=stage3d.isWebGPU] - Whether to flip the text vertically
 * @returns {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D}} The resulting canvas and its context
 */
export function text2canvas( text, {
	fontFamily = 'Helvetica',
	weight = 400,
	fontSize = 64,
	margin = 64,
	color = 'white',
	background = 'white',
	maxWidth,
	scaleX = 1,
	lineHeight = 1.2,
	letterSpacing = 0,
	flipY = stage3d.isWebGPU
} = {} ) {
	const canvas = document.createElement( 'canvas' )
	const ctx = canvas.getContext( '2d' )
	const font = `${weight} ${fontSize}px ${fontFamily}`

	const setCtx = () => {
		ctx.font = font
		ctx.letterSpacing = `${letterSpacing}px`
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillStyle = color
	}

	setCtx()

	const { width: initWidth } = ctx.measureText( text )
	const letterOffset = ( text.length - 1 ) * letterSpacing
	canvas.width = Math.ceil( initWidth + letterOffset + margin * 2 )
	canvas.height = Math.ceil( fontSize + margin * 2 )

	ctx.fillStyle = background
	ctx.fillRect( 0, 0, canvas.width, canvas.height )

	const lines = []
	text.split( '<br>' ).forEach( segment => {
		const words = segment.split( /\s+/ )
		let line = words[0] || ''
		for ( let i = 1; i < words.length; i++ ) {
			const testLine = `${line} ${words[i]}`
			if ( maxWidth && ctx.measureText( testLine ).width > maxWidth ) {
				lines.push( line )
				line = words[i]
			}
			else line = testLine
		}
		lines.push( line )
	} )

	const longest = Math.max( ...lines.map( l => ctx.measureText( l ).width ) )
	const compWidth = Math.min( maxWidth || Infinity, longest )
	canvas.width = Math.ceil( compWidth * scaleX + margin * 2 )
	canvas.height = Math.ceil( fontSize * lines.length * lineHeight + margin * 2 )

	ctx.fillStyle = background
	ctx.fillRect( 0, 0, canvas.width, canvas.height )
	setCtx()

	ctx.save()
	ctx.translate( 0, canvas.height )
	ctx.scale( scaleX, flipY ? -1 : 1 )
	const centerX = canvas.width / ( 2 * scaleX )
	lines.forEach( ( line, i ) => {
		const idx = flipY ? i : ( lines.length - 1 - i )
		const y = margin + fontSize / 2 + idx * fontSize * lineHeight
		ctx.fillText( line, centerX, flipY ? y : -y )
	} )
	ctx.restore()

	return { canvas, context: ctx }
}
