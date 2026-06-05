export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  
  // 根路径重定向到 index.html
  if (url.pathname === '/') {
    return sendRedirect(event, '/index.html', 301)
  }
  
  // /login 重定向到 login.html
  if (url.pathname === '/login') {
    return sendRedirect(event, '/login.html', 301)
  }
})
