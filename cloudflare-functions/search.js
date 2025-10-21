/**
 * Cloudflare Worker - 纯 JavaScript 实现 DuckDuckGo 搜索
 */

export default {
	async fetch(request, env, ctx) {
	  // 处理 CORS 预检请求
	  if (request.method === "OPTIONS") {
		return new Response("", {
		  status: 204,
		  headers: corsHeaders(),
		});
	  }
  
	  const url = new URL(request.url);
	  const path = url.pathname;
	  const params = url.searchParams;
  
	  try {
		if (path === "/search") {
		  return await handleSearch(params);
		} else if (path === "/searchAnswers") {
		  return await handleSearchAnswers(params);
		} else if (path === "/searchImages") {
		  return await handleSearchImages(params);
		} else if (path === "/searchVideos") {
		  return await handleSearchVideos(params);
		} else {
		  return jsonResponse(
			{
			  error: "Not found.",
			  endpoints: ["/search", "/searchAnswers", "/searchImages", "/searchVideos"]
			},
			404
		  );
		}
	  } catch (error) {
		if (error.message.includes("Missing required parameter")) {
		  return jsonResponse({ error: error.message }, 400);
		}
		return jsonResponse(
		  { error: "Internal error", message: error.message },
		  500
		);
	  }
	},
  };
  
  function corsHeaders() {
	return {
	  "Access-Control-Allow-Origin": "*",
	  "Access-Control-Allow-Methods": "GET, OPTIONS",
	  "Access-Control-Allow-Headers": "Content-Type",
	};
  }
  
  function jsonResponse(obj, status = 200) {
	return new Response(JSON.stringify(obj), {
	  status: status,
	  headers: {
		"Content-Type": "application/json; charset=utf-8",
		...corsHeaders(),
	  },
	});
  }
  
  function getParams(params) {
	const q = (params.get("q") || "").trim();
	if (!q) {
	  throw new Error("Missing required parameter: q");
	}
	
	let maxResults = parseInt(params.get("max_results") || "10");
	if (isNaN(maxResults)) maxResults = 10;
	maxResults = Math.max(1, Math.min(20, maxResults));
	
	return { q, maxResults };
  }
  
  function decodeRedirectUrl(ddgUrl) {
	// DuckDuckGo 使用重定向 URL 格式: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com
	try {
	  const url = new URL(ddgUrl.startsWith('//') ? 'https:' + ddgUrl : ddgUrl);
	  
	  // 提取 uddg 参数(实际目标 URL)
	  const uddg = url.searchParams.get('uddg');
	  if (uddg) {
		return decodeURIComponent(uddg);
	  }
	  
	  // 如果没有 uddg,尝试 kl 参数或其他可能的参数
	  const kl = url.searchParams.get('kl');
	  if (kl) {
		return decodeURIComponent(kl);
	  }
	  
	  // 如果都没有,返回原 URL
	  return ddgUrl;
	} catch (error) {
	  // 如果解析失败,返回原 URL
	  return ddgUrl;
	}
  }
  
  function extractResultsLite(html, limit) {
	const results = [];
	// 匹配 DuckDuckGo HTML 结果
	const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis;

	let match;
	while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
	  const href = match[1];
	  // 移除 HTML 标签,保留纯文本
	  const title = match[2].replace(/<[^>]+>/g, "").trim();

	  if (href && title) {
		// 解码 DuckDuckGo 的重定向 URL,获取真实目标 URL
		const realUrl = decodeRedirectUrl(href);
		results.push({ title, url: realUrl });
	  }
	}

	return results;
  }

  function extractGoogleResults(html, limit) {
	const results = [];
	const linkRegex1 = /<a[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*><h3[^>]*>(.*?)<\/h3>/gis;
	const linkRegex2 = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*><h3[^>]*>(.*?)<\/h3>/gis;
	const linkRegex3 = /<a[^>]*jsname="[^"]*"[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>[^<]*<h3[^>]*>(.*?)<\/h3>/gis;
	const linkRegex4 = /<div class="[^"]*yuRUbf[^"]*"[^>]*>.*?<a href="([^"]+)"[^>]*>.*?<h3[^>]*>(.*?)<\/h3>/gis;
	const linkRegex5 = /<a[^>]*href="([^"]+)"[^>]*data-ved="[^"]*"[^>]*><br><div[^>]*><div[^>]*><div[^>]*><h3[^>]*>(.*?)<\/h3>/gis;
	const regexPatterns = [linkRegex4, linkRegex1, linkRegex2, linkRegex3, linkRegex5];
	for (const regex of regexPatterns) {
	  let match;
	  while ((match = regex.exec(html)) !== null && results.length < limit) {
		let url = match[1];
		const title = match[2].replace(/<[^>]+>/g, "").trim();
		if (url && title) {
		  if (url.startsWith('/url?q=')) {
			const urlMatch = url.match(/\/url\?q=([^&]+)/);
			if (urlMatch) url = decodeURIComponent(urlMatch[1]);
		  }
		  if (url.startsWith('http') && !url.includes('google.com/search') && !url.includes('webcache.googleusercontent.com')) {
			try {
			  const decodedUrl = decodeURIComponent(url);
			  if (!results.find(r => r.url === decodedUrl)) {
				results.push({ title, url: decodedUrl });
			  }
			} catch (e) {}
		  }
		}
	  }
	  if (results.length >= limit) break;
	}
	return results;
  }

  function extractBingResults(html, limit) {
	const results = [];
	const linkRegex1 = /<li class="[^"]*b_algo[^"]*"[^>]*>.*?<h2[^>]*>.*?<a href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
	const linkRegex2 = /<h2[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<\/h2>/gis;
	const linkRegex3 = /<div[^>]*class="[^"]*b_title[^"]*"[^>]*>.*?<h2[^>]*>.*?<a href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
	const linkRegex4 = /<a[^>]*href="([^"]+)"[^>]*><h2[^>]*>(.*?)<\/h2><\/a>/gis;
	const regexPatterns = [linkRegex1, linkRegex2, linkRegex3, linkRegex4];
	for (const regex of regexPatterns) {
	  let match;
	  while ((match = regex.exec(html)) !== null && results.length < limit) {
		const url = match[1];
		const title = match[2].replace(/<[^>]+>/g, "").trim();
		if (url && title && url.startsWith('http') && !url.includes('bing.com/search') && !url.includes('microsoft.com/')) {
		  try {
			const decodedUrl = decodeURIComponent(url);
			if (!results.find(r => r.url === decodedUrl)) {
			  results.push({ title, url: decodedUrl });
			}
		  } catch (e) {}
		}
	  }
	  if (results.length >= limit) break;
	}
	return results;
  }

  async function searchWithDuckDuckGo(q, maxResults) {
	const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
	const response = await fetch(url, {
	  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
	});
	if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
	const html = await response.text();
	const htmlSlice = html.slice(0, 150000);
	const results = extractResultsLite(htmlSlice, maxResults);
	return { q: q, results: results };
  }

  async function searchWithGoogle(q, maxResults) {
	const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=${maxResults}&hl=en`;
	const response = await fetch(url, {
	  headers: {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		"DNT": "1",
		"Connection": "keep-alive",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		"Cache-Control": "max-age=0",
	  },
	  redirect: "follow",
	});
	if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
	const html = await response.text();
	const htmlSlice = html.slice(0, 200000);
	const results = extractGoogleResults(htmlSlice, maxResults);
	return { q: q, results: results };
  }

  async function searchWithBing(q, maxResults) {
	const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=${maxResults}`;
	const response = await fetch(url, {
	  headers: {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
		"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		"DNT": "1",
		"Connection": "keep-alive",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		"Cache-Control": "max-age=0",
	  },
	  redirect: "follow",
	});
	if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
	const html = await response.text();
	const htmlSlice = html.slice(0, 200000);
	const results = extractBingResults(htmlSlice, maxResults);
	return { q: q, results: results };
  }

  function getSearchEngine(engineName) {
	const engines = {
	  duckduckgo: searchWithDuckDuckGo,
	  google: searchWithGoogle,
	  bing: searchWithBing
	};
	return engines[engineName] || engines.duckduckgo;
  }

  async function handleSearch(params) {
	const { q, maxResults } = getParams(params);
	const engine = (params.get("engine") || "duckduckgo").toLowerCase().trim();

	const searchEngine = getSearchEngine(engine);

	try {
	  const result = await searchEngine(q, maxResults);
	  return jsonResponse(result);
	} catch (error) {
	  return jsonResponse(
		{ error: error.message, q: q },
		502
	  );
	}
  }
  
  async function handleSearchAnswers(params) {
	const { q } = getParams(params);
	const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
	
	const response = await fetch(url, {
	  headers: {
		"User-Agent": "Mozilla/5.0 (Workers)",
	  },
	});
	
	if (!response.ok) {
	  return jsonResponse(
		{ error: `HTTP error: ${response.status}` },
		502
	  );
	}
	
	const data = await response.json();
	
	const abstract = (data.AbstractText || "").trim();
	const answer = abstract ? {
	  abstract: abstract,
	  abstract_source: data.AbstractSource,
	  abstract_url: data.AbstractURL,
	} : null;
	
	const related = [];
	const relatedTopics = data.RelatedTopics || [];
	
	for (const topic of relatedTopics) {
	  if (related.length >= 10) break;
	  
	  if (topic.Text && topic.FirstURL) {
		related.push({
		  title: topic.Text,
		  url: topic.FirstURL,
		});
	  } else if (topic.Topics) {
		for (const subTopic of topic.Topics) {
		  if (related.length >= 10) break;
		  if (subTopic.Text && subTopic.FirstURL) {
			related.push({
			  title: subTopic.Text,
			  url: subTopic.FirstURL,
			});
		  }
		}
	  }
	}
	
	return jsonResponse({
	  q: q,
	  answer: answer,
	  related: related,
	});
  }
  
  async function getVqd(query) {
	// 获取 vqd token,DuckDuckGo 需要此 token 进行图片和视频搜索
	const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
	
	try {
	  const response = await fetch(url, {
		headers: {
		  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		},
	  });
	  
	  const html = await response.text();
	  
	  // 从 HTML 中提取 vqd token
	  const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/);
	  if (vqdMatch && vqdMatch[1]) {
		return vqdMatch[1];
	  }
	  
	  // 备用方案: 从 JavaScript 变量中提取
	  const vqdMatch2 = html.match(/vqd=([^&"']+)/);
	  if (vqdMatch2 && vqdMatch2[1]) {
		return vqdMatch2[1];
	  }
	  
	  return null;
	} catch (error) {
	  console.error("Error getting vqd:", error);
	  return null;
	}
  }
  
  async function handleSearchImages(params) {
	const { q, maxResults } = getParams(params);
	
	// 获取 vqd token
	const vqd = await getVqd(q);
	if (!vqd) {
	  return jsonResponse(
		{ error: "Failed to get vqd token", q: q },
		502
	  );
	}
	
	// 构建图片搜索 API URL
	const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(q)}&vqd=${vqd}&l=us-en&p=1&s=0`;
	
	try {
	  const response = await fetch(url, {
		headers: {
		  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		  "Referer": "https://duckduckgo.com/",
		},
	  });
	  
	  if (!response.ok) {
		return jsonResponse(
		  { error: `HTTP error: ${response.status}`, q: q },
		  502
		);
	  }
	  
	  const data = await response.json();
	  const results = [];
	  
	  if (data.results) {
		for (const item of data.results.slice(0, maxResults)) {
		  // 解码图片来源 URL
		  const realUrl = item.url ? decodeRedirectUrl(item.url) : "";
		  
		  results.push({
			title: item.title || "",
			url: realUrl,
			image: item.image || "",
			thumbnail: item.thumbnail || "",
			height: item.height || 0,
			width: item.width || 0,
			source: item.source || "",
		  });
		}
	  }
	  
	  return jsonResponse({
		q: q,
		vqd: vqd,
		results: results,
	  });
	} catch (error) {
	  return jsonResponse(
		{ error: "Failed to fetch images", message: error.message, q: q },
		502
	  );
	}
  }
  
  async function handleSearchVideos(params) {
	const { q, maxResults } = getParams(params);
	
	// 获取 vqd token
	const vqd = await getVqd(q);
	if (!vqd) {
	  return jsonResponse(
		{ error: "Failed to get vqd token", q: q },
		502
	  );
	}
	
	// 构建视频搜索 API URL
	const url = `https://duckduckgo.com/v.js?q=${encodeURIComponent(q)}&vqd=${vqd}&l=us-en&p=1&s=0`;
	
	try {
	  const response = await fetch(url, {
		headers: {
		  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		  "Referer": "https://duckduckgo.com/",
		},
	  });
	  
	  if (!response.ok) {
		return jsonResponse(
		  { error: `HTTP error: ${response.status}`, q: q },
		  502
		);
	  }
	  
	  const data = await response.json();
	  const results = [];
	  
	  if (data.results) {
		for (const item of data.results.slice(0, maxResults)) {
		  // 解码视频 URL
		  const realUrl = item.content ? decodeRedirectUrl(item.content) : "";
		  const embedUrl = item.embed_url ? decodeRedirectUrl(item.embed_url) : "";
		  
		  results.push({
			title: item.title || "",
			description: item.description || "",
			url: realUrl,
			embed_url: embedUrl,
			thumbnail: item.images?.large || item.images?.medium || item.images?.small || "",
			duration: item.duration || "",
			published: item.published || "",
			publisher: item.publisher || "",
			uploader: item.uploader || "",
		  });
		}
	  }
	  
	  return jsonResponse({
		q: q,
		vqd: vqd,
		results: results,
	  });
	} catch (error) {
	  return jsonResponse(
		{ error: "Failed to fetch videos", message: error.message, q: q },
		502
	  );
	}
  }
