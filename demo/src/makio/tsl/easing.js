import { float, sub, pow, sin, cos, sqrt, Fn, mul, select } from 'three/tsl'

const PI = float( 3.141592653589793 )//.toConst()

export const backOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const f = sub( 1.0, t ).toVar()

	return sub( 1.0, pow( f, 3.0 ).sub( f.mul( sin( f.mul( PI ) ) ) ) ).toVar()

}, { t: 'float', return: 'float' } )

export const backInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const f = select( t.lessThan( 0.5 ), mul( 2.0, t ), sub( 1.0, mul( 2.0, t ).sub( 1.0 ) ) )
	const g = pow( f, 3.0 ).sub( f.mul( sin( f.mul( PI ) ) ) )

	return select( t.lessThan( 0.5 ), mul( 0.5, g ), mul( 0.5, sub( 1.0, g ) ).add( 0.5 ) )

}, { t: 'float', return: 'float' } )

export const backIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return pow( t, 3.0 ).sub( t.mul( sin( t.mul( PI ) ) ) ).toVar()

}, { t: 'float', return: 'float' } )

// Linear
export const linear = /*@__PURE__*/ Fn( ( [t] ) => {

	return t

}, { t: 'float', return: 'float' } )

// Sine
export const sineIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return sub( 1.0, cos( t.mul( PI ).mul( 0.5 ) ) )

}, { t: 'float', return: 'float' } )

export const sineOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return sin( t.mul( PI ).mul( 0.5 ) )

}, { t: 'float', return: 'float' } )

export const sineInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return mul( 0.5, sub( 1.0, cos( t.mul( PI ) ) ) )

}, { t: 'float', return: 'float' } )

// Quadratic
export const quadraticIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return pow( t, 2.0 )

}, { t: 'float', return: 'float' } )

export const quadraticOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return t.mul( sub( 2.0, t ) )

}, { t: 'float', return: 'float' } )

export const quadraticInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, pow( twoT, 2.0 ) )
	const second = sub( 1.0, mul( 0.5, pow( sub( 2.0, twoT ), 2.0 ) ) )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )

// Cubic
export const cubicIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return pow( t, 3.0 )

}, { t: 'float', return: 'float' } )

export const cubicOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return sub( 1.0, pow( sub( 1.0, t ), 3.0 ) )

}, { t: 'float', return: 'float' } )

export const cubicInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, pow( twoT, 3.0 ) )
	const second = sub( 1.0, mul( 0.5, pow( sub( 2.0, twoT ), 3.0 ) ) )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )

// Quartic
export const quarticIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return pow( t, 4.0 )

}, { t: 'float', return: 'float' } )

export const quarticOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return sub( 1.0, pow( sub( 1.0, t ), 4.0 ) )

}, { t: 'float', return: 'float' } )

export const quarticInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, pow( twoT, 4.0 ) )
	const second = sub( 1.0, mul( 0.5, pow( sub( 2.0, twoT ), 4.0 ) ) )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )

// Quintic
export const quinticIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return pow( t, 5.0 )

}, { t: 'float', return: 'float' } )

export const quinticOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return sub( 1.0, pow( sub( 1.0, t ), 5.0 ) )

}, { t: 'float', return: 'float' } )

export const quinticInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, pow( twoT, 5.0 ) )
	const second = sub( 1.0, mul( 0.5, pow( sub( 2.0, twoT ), 5.0 ) ) )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )

// Exponential
export const exponentialIn = /*@__PURE__*/ Fn( ( [t] ) => {

	// if (t == 0.0) return 0.0; else return pow(2.0, 10.0 * (t - 1.0));
	const isZero = t.equal( 0.0 )
	return select( isZero, float( 0.0 ), pow( 2.0, mul( 10.0, sub( t, 1.0 ) ) ) )

}, { t: 'float', return: 'float' } )

export const exponentialOut = /*@__PURE__*/ Fn( ( [t] ) => {

	// if (t == 1.0) return 1.0; else return 1.0 - pow(2.0, -10.0 * t);
	const isOne = t.equal( 1.0 )
	return select( isOne, float( 1.0 ), sub( 1.0, pow( 2.0, mul( -10.0, t ) ) ) )

}, { t: 'float', return: 'float' } )

export const exponentialInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	// Handle t == 0 and t == 1 explicitly
	const isZero = t.equal( 0.0 )
	const isOne = t.equal( 1.0 )
	const early = select( isZero, float( 0.0 ), select( isOne, float( 1.0 ), float( -1.0 ) ) ).toVar()
	const twoT = mul( 2.0, t )
	const first = mul( 0.5, pow( 2.0, sub( mul( 10.0, twoT ), 10.0 ) ) )
	const second = sub( 1.0, mul( 0.5, pow( 2.0, sub( mul( -10.0, twoT ), -10.0 ) ) ) )
	// If early was set (0 or 1), return it; else select piecewise
	return select( early.equal( -1.0 ), select( t.lessThan( 0.5 ), first, second ), early )

}, { t: 'float', return: 'float' } )

// Circular
export const circularIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return sub( 1.0, sqrt( sub( 1.0, pow( t, 2.0 ) ) ) )

}, { t: 'float', return: 'float' } )

export const circularOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const f = sub( 1.0, t )
	return sqrt( sub( 1.0, pow( f, 2.0 ) ) )

}, { t: 'float', return: 'float' } )

export const circularInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, sub( 1.0, sqrt( sub( 1.0, pow( twoT, 2.0 ) ) ) ) )
	const second = mul( 0.5, sqrt( sub( 1.0, pow( sub( 2.0, twoT ), 2.0 ) ) ) ).add( 0.5 )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )

// Elastic (glsl-easings variants)
export const elasticIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return sin( t.mul( PI ).mul( 6.5 ) ).mul( pow( 2.0, mul( 10.0, sub( t, 1.0 ) ) ) )

}, { t: 'float', return: 'float' } )

export const elasticOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return sin( sub( 0.0, ( t.add( 1.0 ) ).mul( PI ).mul( 6.5 ) ) ).mul( pow( 2.0, mul( -10.0, t ) ) ).add( 1.0 )

}, { t: 'float', return: 'float' } )

export const elasticInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, sin( twoT.mul( PI ).mul( 6.5 ) ).mul( pow( 2.0, mul( 10.0, sub( twoT, 1.0 ) ) ) ) )
	const second = mul( 0.5, sin( sub( 0.0, twoT.mul( PI ).mul( 6.5 ) ) ).mul( pow( 2.0, mul( -10.0, sub( twoT, 1.0 ) ) ) ) ).add( 1.0 )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )

// Bounce
const __bounceOutCore = /*@__PURE__*/ Fn( ( [t] ) => {

	const a = float( 4.0 / 11.0 )
	const b = float( 8.0 / 11.0 )
	const c = float( 9.0 / 10.0 )

	const t_lt_a = t.lessThan( a )
	const t_lt_b = t.lessThan( b )
	const t_lt_c = t.lessThan( c )

	const r1 = t.mul( t ).mul( 121.0 / 16.0 )
	const r2 = t.mul( t ).mul( 363.0 / 40.0 ).sub( t.mul( 99.0 / 10.0 ) ).add( 17.0 / 5.0 )
	const r3 = t.mul( t ).mul( 4356.0 / 361.0 ).sub( t.mul( 35442.0 / 1805.0 ) ).add( 16061.0 / 1805.0 )
	const r4 = t.mul( t ).mul( 54.0 / 5.0 ).sub( t.mul( 513.0 / 25.0 ) ).add( 268.0 / 25.0 )

	// piecewise: t<a ? r1 : t<b ? r2 : t<c ? r3 : r4
	return select( t_lt_a, r1, select( t_lt_b, r2, select( t_lt_c, r3, r4 ) ) )

}, { t: 'float', return: 'float' } )

export const bounceOut = /*@__PURE__*/ Fn( ( [t] ) => {

	return __bounceOutCore( t )

}, { t: 'float', return: 'float' } )

export const bounceIn = /*@__PURE__*/ Fn( ( [t] ) => {

	return sub( 1.0, __bounceOutCore( sub( 1.0, t ) ) )

}, { t: 'float', return: 'float' } )

export const bounceInOut = /*@__PURE__*/ Fn( ( [t] ) => {

	const twoT = mul( 2.0, t ).toVar()
	const first = mul( 0.5, sub( 1.0, __bounceOutCore( sub( 1.0, twoT ) ) ) )
	const second = mul( 0.5, __bounceOutCore( sub( twoT, 1.0 ) ) ).add( 0.5 )
	return select( t.lessThan( 0.5 ), first, second )

}, { t: 'float', return: 'float' } )
