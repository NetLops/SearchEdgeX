/**
 * EdgeOne Pages Edge Function - DuckDuckGo 搜索 API
 * 文件路径: /edge-functions/search.ts
 * 访问路由: https://your-domain.com/search
 */

interface Context {
  request: Request;
  params: Record<string, string>;
  env: Record<string, string>;
  waitUntil: (promise: Promise<any>) => void;
}

// CORS 响应头
function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// JSON 响应
function jsonResponse(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

// 获取查询参数
function getParams(url: URL) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    throw new Error("Missing required parameter: q");
  }

  let maxResults = parseInt(url.searchParams.get("max_results") || "10");
  if (isNaN(maxResults)) maxResults = 10;
  maxResults = Math.max(1, Math.min(20, maxResults));

  return { q, maxResults };
}

// 解码 DuckDuckGo 重定向 URL
function decodeRedirectUrl(ddgUrl: string): string {
  try {
    const url = new URL(ddgUrl.startsWith("//") ? "https:" + ddgUrl : ddgUrl);

    const uddg = url.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }

    const kl = url.searchParams.get("kl");
    if (kl) {
      return decodeURIComponent(kl);
    }

    return ddgUrl;
  } catch (error) {
    return ddgUrl;
  }
}

// 从 HTML 提取搜索结果
function extractResultsLite(html: string, limit: number) {
  const results: Array<{ title: string; url: string }> = [];
  const linkRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis;

  let match: RegExpExecArray | null;
  while (
    (match = linkRegex.exec(html)) !== null &&
    results.length < limit
  ) {
    const href = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();

    if (href && title) {
      const realUrl = decodeRedirectUrl(href);
      results.push({ title, url: realUrl });
    }
  }

  return results;
}

// 获取 vqd token
async function getVqd(query: string): Promise<string | null> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const html = await response.text();

    const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/);
    if (vqdMatch && vqdMatch[1]) {
      return vqdMatch[1];
    }

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

// 网页搜索
async function handleWebSearch(url: URL) {
  const { q, maxResults } = getParams(url);
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    return jsonResponse({ error: `HTTP error: ${response.status}` }, 502);
  }

  const html = await response.text();
  const htmlSlice = html.slice(0, 150000);
  const results = extractResultsLite(htmlSlice, maxResults);

  return jsonResponse({
    q: q,
    results: results,
  });
}

// 即时答案搜索
async function handleAnswersSearch(url: URL) {
  const { q } = getParams(url);
  const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(
    q
  )}&format=json&no_html=1&skip_disambig=1`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (EdgeOne)",
    },
  });

  if (!response.ok) {
    return jsonResponse({ error: `HTTP error: ${response.status}` }, 502);
  }

  const data = await response.json();

  const abstract = (data.AbstractText || "").trim();
  const answer = abstract
    ? {
        abstract: abstract,
        abstract_source: data.AbstractSource,
        abstract_url: data.AbstractURL,
      }
    : null;

  const related: Array<{ title: string; url: string }> = [];
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

// 图片搜索
async function handleImageSearch(url: URL) {
  const { q, maxResults } = getParams(url);

  const vqd = await getVqd(q);
  if (!vqd) {
    return jsonResponse({ error: "Failed to get vqd token", q: q }, 502);
  }

  const apiUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(
    q
  )}&vqd=${vqd}&l=us-en&p=1&s=0`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://duckduckgo.com/",
      },
    });

    if (!response.ok) {
      return jsonResponse({ error: `HTTP error: ${response.status}`, q: q }, 502);
    }

    const data = await response.json();
    const results: any[] = [];

    if (data.results) {
      for (const item of data.results.slice(0, maxResults)) {
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
  } catch (error: any) {
    return jsonResponse(
      { error: "Failed to fetch images", message: error.message, q: q },
      502
    );
  }
}

// 视频搜索
async function handleVideoSearch(url: URL) {
  const { q, maxResults } = getParams(url);

  const vqd = await getVqd(q);
  if (!vqd) {
    return jsonResponse({ error: "Failed to get vqd token", q: q }, 502);
  }

  const apiUrl = `https://duckduckgo.com/v.js?q=${encodeURIComponent(
    q
  )}&vqd=${vqd}&l=us-en&p=1&s=0`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://duckduckgo.com/",
      },
    });

    if (!response.ok) {
      return jsonResponse({ error: `HTTP error: ${response.status}`, q: q }, 502);
    }

    const data = await response.json();
    const results: any[] = [];

    if (data.results) {
      for (const item of data.results.slice(0, maxResults)) {
        const realUrl = item.content ? decodeRedirectUrl(item.content) : "";
        const embedUrl = item.embed_url ? decodeRedirectUrl(item.embed_url) : "";

        results.push({
          title: item.title || "",
          description: item.description || "",
          url: realUrl,
          embed_url: embedUrl,
          thumbnail:
            item.images?.large ||
            item.images?.medium ||
            item.images?.small ||
            "",
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
  } catch (error: any) {
    return jsonResponse(
      { error: "Failed to fetch videos", message: error.message, q: q },
      502
    );
  }
}

// 主函数 - 使用 onRequestGet 处理 GET 请求
export async function onRequestGet(context: Context): Promise<Response> {
  const url = new URL(context.request.url);
  const type = url.searchParams.get("type") || "web";

  try {
    switch (type) {
      case "web":
        return await handleWebSearch(url);
      case "answers":
        return await handleAnswersSearch(url);
      case "images":
        return await handleImageSearch(url);
      case "videos":
        return await handleVideoSearch(url);
      default:
        return jsonResponse(
          {
            error: "Invalid type parameter",
            allowed_types: ["web", "answers", "images", "videos"],
          },
          400
        );
    }
  } catch (error: any) {
    if (error.message.includes("Missing required parameter")) {
      return jsonResponse({ error: error.message }, 400);
    }
    return jsonResponse(
      { error: "Internal error", message: error.message },
      500
    );
  }
}

// 处理 OPTIONS 请求 (CORS 预检)
export function onRequestOptions(context: Context): Response {
  return new Response("", {
    status: 204,
    headers: corsHeaders(),
  });
}
