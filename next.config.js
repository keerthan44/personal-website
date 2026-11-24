// The site is a single static page (public/pro.html) plus API routes for the voice agent.
module.exports = {
  async rewrites() {
    return { beforeFiles: [{ source: '/', destination: '/pro.html' }] };
  },
  async redirects() {
    return [{ source: '/pro.html', destination: '/', permanent: true }];
  },
};
