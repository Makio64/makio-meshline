// PRNG from FXhash https://www.fxhash.xyz/doc/artist/guide-publish-generative-token

const alphabet = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'

const fxseed = window.fxseed || generateSeed()
window.fxseed = fxseed

export const random = ( min = 0, max = 1 ) => min + fxrand() * ( max - min )

export const choice = ( choice1, choice2 ) => ( random() < 0.5 ? choice1 : choice2 )

export const pickInArray = ( array ) => array[Math.floor( array.length * fxrand() )]

export const randomInt = ( min = 0, max = 1 ) => Math.round( random( min, max ) )

export const shuffleArray = ( a ) => {
	let t, j, i = a.length
	while ( --i > 0 ) {
		j = Math.floor( random() * ( i + 1 ) )
		t = a[j]
		a[j] = a[i]
		a[i] = t
	}
	return a
}

export const resetRandom = () => ( fxrand = initRandom() )

function generateSeed() {
	const seedFromURL = new URLSearchParams( window.location.search ).get( 'fxseed' )
	if ( seedFromURL ) return seedFromURL
	return ( 'oo' + Array( 49 )	.fill( 0 ).map( ( _ ) => alphabet[( Math.random() * alphabet.length ) | 0] ).join( '' ) )
}

function initRandom() {
	let b58dec = ( str ) => [...str].reduce( ( p, c ) => ( p * alphabet.length + alphabet.indexOf( c ) ) | 0, 0 )
	let fxhashTrunc = fxseed.slice( 2 )
	let regex = new RegExp( '.{' + ( ( fxhashTrunc.length / 4 ) | 0 ) + '}', 'g' )
	let hashes = fxhashTrunc.match( regex ).map( ( h ) => b58dec( h ) )
	let sfc32 = ( a, b, c, d ) => {
		return () => {
			a |= 0
			b |= 0
			c |= 0
			d |= 0
			var t = ( ( ( a + b ) | 0 ) + d ) | 0
			d = ( d + 1 ) | 0
			a = b ^ ( b >>> 9 )
			b = ( c + ( c << 3 ) ) | 0
			c = ( c << 21 ) | ( c >>> 11 )
			c = ( c + t ) | 0
			return ( t >>> 0 ) / 4294967296
		}
	}
	return sfc32( ...hashes )
}

let fxrand = window.fxrand || initRandom()
window.fxrand = fxrand

export default random
