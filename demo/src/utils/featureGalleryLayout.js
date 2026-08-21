import { MathUtils } from 'three/webgpu'

const DESKTOP_COLUMNS = 4
const PORTRAIT_COLUMNS = 2
const DEFAULT_FOV = 55

const toPositiveNumber = ( value, fallback ) => {
	return Number.isFinite( value ) && value > 0 ? value : fallback
}

export const getFeatureGalleryLayout = ( {
	width,
	height,
	count = 16,
	fov = DEFAULT_FOV,
} ) => {
	const viewportWidth = toPositiveNumber( width, 1280 )
	const viewportHeight = toPositiveNumber( height, 720 )
	const itemCount = Math.max( 1, Math.floor( toPositiveNumber( count, 16 ) ) )
	const portrait = viewportWidth <= 600 && viewportHeight > viewportWidth * 1.15
	const columns = portrait ? PORTRAIT_COLUMNS : DESKTOP_COLUMNS
	const rows = Math.ceil( itemCount / columns )
	const spacingX = portrait ? 3.4 : 4.5
	const spacingY = portrait ? 2.2 : 4.5
	const itemScale = portrait ? 0.88 : 1
	const labelOffset = portrait ? 1.02 : 1.2
	const labelDepth = portrait ? 0.3 : 0.36
	const itemRadius = itemScale * 1.12
	const topPadding = itemRadius
	const bottomPadding = labelOffset + labelDepth
	const centerOffsetY = ( bottomPadding - topPadding ) * 0.5
	const gridHalfHeight = ( rows - 1 ) * spacingY * 0.5
	const contentWidth = ( Math.min( itemCount, columns ) - 1 ) * spacingX + itemRadius * 2
	const contentHeight = gridHalfHeight * 2 + topPadding + bottomPadding
	const safeWidth = portrait ? 0.86 : 0.9
	const safeHeight = portrait ? 0.86 : 0.84
	const halfFovTangent = Math.tan( MathUtils.degToRad( toPositiveNumber( fov, DEFAULT_FOV ) ) * 0.5 )
	const aspect = viewportWidth / viewportHeight
	const verticalDistance = contentHeight / ( 2 * halfFovTangent * safeHeight )
	const horizontalDistance = contentWidth / ( 2 * halfFovTangent * aspect * safeWidth )
	const cameraDistance = Math.max( portrait ? 18 : 20, verticalDistance, horizontalDistance )
	const positions = Array.from( { length: itemCount }, ( _, index ) => {
		const row = Math.floor( index / columns )
		const column = index % columns
		return {
			x: ( column - ( columns - 1 ) * 0.5 ) * spacingX,
			y: centerOffsetY - ( row - ( rows - 1 ) * 0.5 ) * spacingY,
		}
	} )

	return {
		cameraDistance,
		columns,
		contentHeight,
		contentWidth,
		itemScale,
		labelOffset,
		portrait,
		positions,
		rows,
		safeHeight,
		safeWidth,
	}
}
