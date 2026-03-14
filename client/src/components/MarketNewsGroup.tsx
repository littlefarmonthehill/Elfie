import { useState } from "react";
import { ChevronDown, ChevronRight, Newspaper, ExternalLink, Globe, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

interface MarketNewsArticle {
  id: number;
  title: string;
  snippet: string;
  url: string;
  source: string;
  topic: string;
  fetchedAt: string;
  relevance: string;
}

interface MarketNewsGroupProps {
  articles: MarketNewsArticle[];
}

export function MarketNewsGroup({ articles }: MarketNewsGroupProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const handleLinkClick = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const getDomainFromUrl = (url: string): string => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return 'web';
    }
  };

  return (
    <div className="border border-purple-500/20 rounded-lg">
      <div className="px-3 py-2 bg-purple-500/5 border-b border-purple-500/20 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-medium text-purple-300">
            Market News ({articles.length})
          </span>
        </div>
      </div>

      <div className="divide-y divide-purple-500/10">
        {articles.map((article) => {
          const isExpanded = expandedIds.has(article.id);
          const relevancePercent = Math.round(parseFloat(article.relevance) * 100);

          return (
            <div
              key={article.id}
              className="p-3"
              data-testid={`market-news-${article.id}`}
            >
              <button
                onClick={() => toggleExpand(article.id)}
                className="w-full flex items-start gap-2 text-left hover-elevate active-elevate-2 rounded-lg p-2 -m-2"
                data-testid={`button-toggle-news-${article.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-purple-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-purple-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium text-purple-200 line-clamp-2">
                      {article.title}
                    </h4>
                    <span className="text-xs text-purple-400/70 flex-shrink-0">
                      {relevancePercent}% match
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <div className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      <span>{article.source || getDomainFromUrl(article.url)}</span>
                    </div>
                    {article.fetchedAt && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>
                          {formatDistanceToNow(new Date(article.fetchedAt), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3 pl-6 space-y-3">
                  {article.snippet && (
                    <p className="text-sm text-gray-300 leading-relaxed">
                      {article.snippet}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={(e) => handleLinkClick(article.url, e)}
                      variant="outline"
                      size="sm"
                      className="bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200 text-xs h-7"
                      data-testid={`button-view-article-${article.id}`}
                    >
                      <ExternalLink className="h-3 w-3 mr-1.5" />
                      Read Full Article
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
