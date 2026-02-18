export const extractJobData = async (req, res) => {
    try {
        const { content, websiteUrl } = req.body;

        if (!content || typeof content !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Content is required and must be a string'
            });
        }

        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            console.error('OPENAI_API_KEY is not configured in environment variables');
            return res.status(500).json({
                success: false,
                message: 'OpenAI API key is not configured'
            });
        }

        // Prefer faster model for simple extraction (gpt-3.5-turbo is faster; override with OPENAI_MODEL if needed)
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
        const openaiUrl = 'https://api.openai.com/v1/chat/completions';

        // Keep input small for speed: ~6k chars is enough for one job posting
        const maxContentLen = 6000;
        const trimmedContent = content.length > maxContentLen
            ? content.substring(0, maxContentLen) + '\n[...truncated]'
            : content;

        const prompt = `From the job posting below output ONLY this JSON (no markdown, no explanation): {"company":"...","position":"...","description":"..."}. Use "Unknown" if company/position missing; "" for description if missing.\n\n${trimmedContent}`;

        const response = await fetch(openaiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: openaiModel,
                messages: [
                    { role: 'system', content: 'Output only valid JSON. No other text.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 1024
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('OpenAI API error:', errorData);
            return res.status(response.status).json({
                success: false,
                message: errorData.error?.message || `OpenAI API error: ${response.status}`,
                error: errorData
            });
        }

        const data = await response.json();
        const contentText = data.choices?.[0]?.message?.content?.trim() || '{}';

        let extractedData;
        try {
            extractedData = JSON.parse(contentText);
        } catch (parseError) {
            const jsonMatch = contentText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                extractedData = JSON.parse(jsonMatch[0]);
            } else {
                console.error('Failed to parse OpenAI response:', contentText);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to parse OpenAI response as JSON'
                });
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                company: extractedData.company || 'Unknown',
                position: extractedData.position || 'Unknown',
                description: extractedData.description || ''
            }
        });

    } catch (error) {
        console.error('Error in extractJobData:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

