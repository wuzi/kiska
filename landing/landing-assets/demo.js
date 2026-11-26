for (const button of document.querySelectorAll('[data-votes]')) {
  button.addEventListener('click', () => {
    const voted = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(voted));
    button.textContent = '↑　' + (Number(button.dataset.votes) + Number(voted));
  });
}
