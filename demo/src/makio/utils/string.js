import { random } from './random'

// Constants for commonly used character sets
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const COUNT_CHARS = CHARS.length

// Converts the first letter of a string to uppercase
export const capitalizeFirstLetter = ( string ) => string.charAt( 0 ).toUpperCase() + string.slice( 1 )

// Generates a random string of a given length
export const randomString = ( length = 14 ) => {
	return Array.from( { length }, () => CHARS[Math.floor( random() * COUNT_CHARS )] ).join( '' )
}
