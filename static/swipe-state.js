// Recent and Queue share a single revealed row.
export function createSwipeState() {
 const swipes = {
  current: null,
  distance: 96,
  close() {
   if (!swipes.current) return;
   swipes.current.classList.remove('open');
   const surface = swipes.current.querySelector('.result,.row');
   if (surface) surface.style.transform = '';
   swipes.current = null;
  }
 };
 document.addEventListener('pointerdown', event => {
  if (swipes.current && !swipes.current.contains(event.target)) swipes.close();
 });
 return swipes;
}
