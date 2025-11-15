(async function loadPosts() {
  try {
    const response = await fetch('data/posts.json');
    const posts = await response.json();
    const list = document.getElementById('post-list');

    list.innerHTML = '';
    posts.forEach(post => {
      const item = document.createElement('li');
      item.innerHTML = `
        <a href="${post.url}">${post.title}</a>
        <span class="post-meta">${post.date}</span>
      `;
      list.appendChild(item);
    });
  } catch (error) {
    console.error('記事一覧の読み込みに失敗しました', error);
  }
})();
