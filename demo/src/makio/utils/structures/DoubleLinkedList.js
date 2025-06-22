/**
 * DoubleLinkedList: A bi-directional linked list data structure.
 * @author David Ronai / @Makio64
 **/
export default class DoubleLinkedList {
	constructor() {
		this.last = null
		this.root = null
		this.count = 0
		this.indexKey = 'index'
	}

	add( node ) {
		if ( !this.root ) {
			this.root = this.last = node
		} else {
			this.last.next = node
			node.prev = this.last
			this.last = node
		}
		this.count++
	}

	remove( node ) {
		if ( node.prev ) node.prev.next = node.next
		if ( node.next ) node.next.prev = node.prev

		if ( node === this.root ) this.root = node.next
		if ( node === this.last ) this.last = node.prev

		node.next = node.prev = null
		this.count--
	}

	insertSorted( node ) {
		if ( this.count == 0 ) {
			this.add( node )
		} else {
			this.insertInOrder( node )
			// this.insertWithPivot(node, this.root, this.last, this.count)
		}
	}

	// trivial and expensive algorithm
	insertInOrder( node ) {
		let current = this.root
		while ( current ) {
			if ( node[this.indexKey] <= current[this.indexKey] ) {
				this.insertBefore( node, current )
				return
			}
			current = current.next
		}
		this.add( node )
	}

	//insert with pivot point
	insertWithPivot( node ) {
		if ( !node[this.indexKey] ) {
			throw new Error( "Node must have an 'index' property." )
		}

		if ( this.count == 0 ) {
			this.add( node )
			return
		}

		let minNode = this.root
		let maxNode = this.last
		let count = this.count

		while ( count > 2 ) {
			let slow = minNode
			let fast = minNode

			while ( fast !== maxNode && fast.next !== maxNode ) {
				slow = slow.next // Move slow by one step.
				fast = fast.next.next // Move fast by two steps.
			}

			let middleNode = slow

			if ( node[this.indexKey] <= middleNode[this.indexKey] ) {
				maxNode = middleNode
				count = Math.floor( count / 2 )
			} else {
				minNode = middleNode
				count = count - Math.floor( count / 2 )
			}
		}

		if ( node[this.indexKey] <= minNode[this.indexKey] ) {
			this.insertBefore( node, minNode )
		} else if ( node[this.indexKey] >= maxNode[this.indexKey] ) {
			this.insertAfter( node, maxNode )
		} else {
			this.insertAfter( node, minNode )
		}
	}

	insertAfter( node, afterNode ) {
		if ( node == afterNode ) {
			console.warn( 'node == afterNode' )
			return
		}
		let tmp = afterNode.next
		afterNode.next = node
		node.prev = afterNode
		if ( tmp === null ) {
			this.last = node
		} else {
			node.next = tmp
			tmp.prev = node
		}
		this.count++
	}

	insertBefore( node, beforeNode ) {
		if ( node == beforeNode ) {
			console.warn( 'node == beforeNode' )
			return
		}
		let tmp = beforeNode.prev
		beforeNode.prev = node
		node.next = beforeNode
		node.prev = tmp
		if ( tmp === null ) {
			this.root = node
		} else {
			tmp.next = node
		}
		this.count++
	}

	pop() {
		if ( this.isEmpty() ) return null
		const node = this.last
		this.remove( node )
		return node
	}

	shift() {
		if ( this.isEmpty() ) return null
		const node = this.root
		this.remove( node )
		return node
	}

	getNodeAtIdx( idx ) {
		if ( idx >= this.count || idx < 0 ) return null

		let node = this.root
		for ( let i = 0; i < idx && node; i++ ) {
			node = node.next
		}
		return node
	}

	toArray() {
		let array = []
		let node = this.root
		while ( node ) {
			array.push( node )
			node = node.next
		}
		return array
	}

	fromArray( array ) {
		this.reset()
		for ( const item of array ) {
			item.prev = item.next = null
			this.add( item )
		}
	}

	reset() {
		this.last = this.root = null
		this.count = 0
	}

	isEmpty() {
		return this.count === 0
	}

	log() {
		let s = `DoubleLinkedList[${this.count}] : `
		let current = this.root
		while ( current ) {
			s += `${current[this.indexKey]},`
			current = current.next
		}
		console.log( s )
	}
}

export { DoubleLinkedList }
