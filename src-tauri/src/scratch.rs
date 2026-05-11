use ringbuf::{traits::{Consumer, Producer, Split}, HeapRb};
use std::sync::Arc;

fn main() {
    let rb = HeapRb::<f32>::new(1024);
    let (mut prod, mut cons) = rb.split();
    
    prod.push_slice(&[1.0, 2.0, 3.0]);
    
    let occupied = cons.occupied_len();
    cons.skip(occupied);
    
    let free = prod.free_len();
    println!("Free: {}", free);
}
