import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare, ExternalLink, User, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

interface ForumDiscussion {
  id: string;
  threadId: string;
  title: string;
  excerpt: string | null;
  username: string;
  userFeedbackRating: number;
  postedAt: string;
  postUrl: string;
  threadUrl: string;
  hasReplies: boolean;
  relevance: string;
}

interface ForumDiscussionsGroupProps {
  discussions: ForumDiscussion[];
  onExternalLinkClick?: (url: string) => void;
}

export function ForumDiscussionsGroup({ discussions, onExternalLinkClick }: ForumDiscussionsGroupProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
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
    if (onExternalLinkClick) {
      onExternalLinkClick(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const getFeedbackColor = (rating: number) => {
    if (rating >= 100) return 'text-green-400';
    if (rating >= 50) return 'text-blue-400';
    if (rating >= 10) return 'text-gray-400';
    return 'text-gray-500';
  };

  return (
    <div className="border border-purple-500/20 rounded-lg">
      {/* Header */}
      <div className="px-3 py-2 bg-purple-500/5 border-b border-purple-500/20 rounded-t-lg">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-medium text-purple-300">
            BrickLink Community Discussions ({discussions.length})
          </span>
        </div>
      </div>

      {/* Discussion List */}
      <div className="divide-y divide-purple-500/10">
        {discussions.map((discussion) => {
          const isExpanded = expandedIds.has(discussion.id);
          const relevancePercent = Math.round(parseFloat(discussion.relevance) * 100);
          
          return (
            <div
              key={discussion.id}
              className="p-3"
              data-testid={`forum-discussion-${discussion.id}`}
            >
              {/* Discussion Header - Always visible */}
              <button
                onClick={() => toggleExpand(discussion.id)}
                className="w-full flex items-start gap-2 text-left hover-elevate active-elevate-2 rounded-lg p-2 -m-2"
                data-testid={`button-toggle-discussion-${discussion.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-purple-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-purple-400" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0 space-y-1">
                  {/* Title */}
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium text-purple-200 line-clamp-2">
                      {discussion.title}
                    </h4>
                    <span className="text-xs text-purple-400/70 flex-shrink-0">
                      {relevancePercent}% match
                    </span>
                  </div>
                  
                  {/* Author & Date */}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      <span className={getFeedbackColor(discussion.userFeedbackRating)}>
                        {discussion.username}
                      </span>
                      {discussion.userFeedbackRating > 0 && (
                        <span className="text-gray-500">
                          ({discussion.userFeedbackRating})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {formatDistanceToNow(new Date(discussion.postedAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="mt-3 pl-6 space-y-3">
                  {/* Excerpt */}
                  {discussion.excerpt && (
                    <p className="text-sm text-gray-300 leading-relaxed">
                      {discussion.excerpt}
                    </p>
                  )}
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={(e) => handleLinkClick(discussion.threadUrl, e)}
                      variant="outline"
                      size="sm"
                      className="bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200 text-xs h-7"
                      data-testid={`button-view-thread-${discussion.id}`}
                    >
                      <ExternalLink className="h-3 w-3 mr-1.5" />
                      View Full Thread
                    </Button>
                    
                    {discussion.hasReplies && (
                      <span className="text-xs text-gray-500">
                        • Has replies
                      </span>
                    )}
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
